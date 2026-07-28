import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { BadRequestError } from '../lib/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ROOT = path.resolve(here, '../..', env.STORAGE_LOCAL_DIR);

/**
 * Object storage behind a driver (tech.md §1 — S3-compatible with a CDN).
 * The local driver writes to disk and is served by @fastify/static, so the app
 * runs end to end without any cloud account.
 */

const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * tech.md §15 — uploads are validated by content type AND size. The declared
 * mimetype is checked against the file's actual magic bytes, because a client
 * can claim anything.
 */
const MAGIC = [
  { ext: 'jpg', mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'png', mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'webp', mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

export function sniffImage(buffer) {
  for (const sig of MAGIC) {
    if (sig.bytes.every((b, i) => buffer[i] === b)) {
      if (sig.ext === 'webp') {
        const isWebp = buffer.subarray(8, 12).toString('ascii') === 'WEBP';
        if (!isWebp) continue;
      }
      return sig;
    }
  }
  return null;
}

const MAX_BYTES = {
  avatar: 2 * 1024 * 1024,
  banner: 3 * 1024 * 1024,
  cover: 3 * 1024 * 1024,
  question: 3 * 1024 * 1024,
  logo: 1 * 1024 * 1024,
};

export async function storeImage(buffer, { kind = 'avatar', declaredMime } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new BadRequestError('No file received.', 'NO_FILE');
  }
  const limit = MAX_BYTES[kind] ?? 2 * 1024 * 1024;
  if (buffer.length > limit) {
    throw new BadRequestError(
      `That image is too large. Keep it under ${Math.round(limit / 1024 / 1024)}MB.`,
      'FILE_TOO_LARGE',
    );
  }

  const sniffed = sniffImage(buffer);
  if (!sniffed || !ALLOWED[sniffed.mime]) {
    throw new BadRequestError('Upload a JPEG, PNG or WebP image.', 'BAD_FILE_TYPE');
  }
  if (declaredMime && ALLOWED[declaredMime] && declaredMime !== sniffed.mime) {
    throw new BadRequestError('That file is not the type it claims to be.', 'MIME_MISMATCH');
  }

  const name = `${kind}/${crypto.randomUUID()}.${sniffed.ext}`;

  if (env.STORAGE_DRIVER === 'minio') return storeToMinio(name, buffer, sniffed.mime);
  if (env.STORAGE_DRIVER === 's3') return storeToS3(name, buffer, sniffed.mime);
  return storeToDisk(name, buffer);
}

// ── MinIO ──────────────────────────────────────────────────────────────────

let minioClient = null;

async function getMinio() {
  if (minioClient) return minioClient;
  if (!env.MINIO_ENDPOINT) throw new Error('MINIO_ENDPOINT is not configured');
  const { Client } = await import('minio');
  minioClient = new Client({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
  });
  return minioClient;
}

/** The URL a stored object is served from. Path-style: endpoint/bucket/key. */
export function minioPublicUrl(key) {
  const base =
    env.MINIO_PUBLIC_BASE ||
    `${env.MINIO_USE_SSL ? 'https' : 'http'}://${env.MINIO_ENDPOINT}${
      env.MINIO_PORT === 443 || env.MINIO_PORT === 80 ? '' : `:${env.MINIO_PORT}`
    }/${env.MINIO_BUCKET}`;
  return `${base}/${key}`;
}

/**
 * Store a named object in MinIO. Exported for the seed, which uploads with a
 * stable key (`covers/<slug>.jpg`) so re-seeding overwrites rather than piling
 * up orphans — the same idempotency rule the rest of the seed follows.
 */
let bucketReady = false;

/**
 * The bucket must allow anonymous GET: covers and avatars are fetched by the
 * app with no credentials. Applied once per process, and any failure surfaces
 * on the first upload rather than as images that quietly 403 on the phone.
 */
async function ensureBucket(client) {
  if (bucketReady) return;
  // `bucketExists` needs ListBucket and can report false on a bucket we own,
  // so treat "already owned" from makeBucket as success rather than trusting it.
  const exists = await client.bucketExists(env.MINIO_BUCKET).catch(() => false);
  if (!exists) {
    await client.makeBucket(env.MINIO_BUCKET).catch((err) => {
      if (err?.code !== 'BucketAlreadyOwnedByYou' && err?.code !== 'BucketAlreadyExists') throw err;
    });
  }
  await client.setBucketPolicy(
    env.MINIO_BUCKET,
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${env.MINIO_BUCKET}/*`],
        },
      ],
    }),
  );
  bucketReady = true;
}

export async function storeToMinio(name, buffer, contentType) {
  const client = await getMinio();
  await ensureBucket(client);
  await client.putObject(env.MINIO_BUCKET, name, buffer, buffer.length, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  return { url: minioPublicUrl(name), key: name, driver: 'minio' };
}

async function storeToDisk(name, buffer) {
  const target = path.join(LOCAL_ROOT, name);
  // Guard against a traversal in `kind` before anything touches the disk.
  if (!target.startsWith(LOCAL_ROOT)) throw new BadRequestError('Bad upload path.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return { url: `${env.PUBLIC_URL}/uploads/${name}`, key: name, driver: 'local' };
}

/**
 * S3 upload via a presigned PUT would normally go through the AWS SDK. That
 * dependency is deliberately not pulled in until the driver is actually
 * used — the local driver covers development and the tests.
 */
async function storeToS3(name, buffer, contentType) {
  if (!env.S3_BUCKET) throw new Error('S3_BUCKET is not configured');
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3').catch(() => {
    throw new Error('Install @aws-sdk/client-s3 to use the s3 storage driver');
  });
  const client = new S3Client({ region: env.S3_REGION });
  await client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: name,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  const base = env.S3_PUBLIC_BASE || `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;
  return { url: `${base}/${name}`, key: name, driver: 's3' };
}

/**
 * design.md §12 — topics without art get a generated cover: the topic initial
 * on a tint derived from its category. Generated as an SVG data URI so it costs
 * nothing to store and scales to any density.
 *
 * The gradient runs from the category colour to a darker mix of *itself*, not
 * to a fixed dark. Since v2 these tiles sit on white cards, and a common dark
 * foot made every cover in the feed end the same colour — which turned a wall
 * of topics into a wall of one topic.
 */
export function generatedCoverFor(topicName, color = '#5B4CE6') {
  const initial = String(topicName ?? '?')
    .trim()
    .charAt(0)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${color}" stop-opacity="1"/>
<stop offset="100%" stop-color="${darken(color, 0.34)}" stop-opacity="1"/>
</linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<circle cx="1010" cy="120" r="210" fill="#FFFFFF" fill-opacity="0.08"/>
<circle cx="180" cy="600" r="170" fill="#FFFFFF" fill-opacity="0.06"/>
<text x="600" y="440" font-family="Poppins, Inter, Arial, sans-serif" font-size="330" font-weight="700" fill="#FFFFFF" fill-opacity="0.9" text-anchor="middle">${initial}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Mix a hex colour toward black by `amount` (0–1). */
function darken(hex, amount) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  const mix = (channel) => Math.max(0, Math.round(channel * (1 - amount)));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
