import crypto from 'node:crypto';

/**
 * Hashing helpers. Node's built-in scrypt is used rather than bcrypt so the
 * server has no native build step — one less thing to break on a deploy.
 */

const SCRYPT_KEYLEN = 32;
const SCRYPT_COST = 16384; // 2^14

/** Salted scrypt hash, for anything an attacker could brute force: OTPs, passwords. */
export function hashSecret(plain) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(plain), salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifySecret(plain, stored) {
  if (!stored) return false;
  const [scheme, cost, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  try {
    const derived = crypto.scryptSync(String(plain), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, {
      N: Number(cost),
    });
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Plain SHA-256, for high-entropy values that need constant-time lookup —
 * refresh tokens, where the secret is 256 random bits and a salt would mean
 * we could not find the row.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** A 6-digit OTP with uniform distribution — no modulo bias. */
export function randomOtp() {
  let n;
  do {
    n = crypto.randomBytes(4).readUInt32BE(0);
  } while (n >= 4_294_000_000);
  return String(n % 1_000_000).padStart(6, '0');
}

/** Unambiguous alphabet — no O/0, I/1 — because join codes get read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomJoinCode(length = 6) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/**
 * Normalised hash of question content, for duplicate detection
 * (prd.md F8.2.7). Case, punctuation and whitespace are stripped so
 * "Who wrote Hamlet?" and "who wrote hamlet" collide as they should.
 */
export function contentHashOf(text, options = []) {
  const normalise = (s) =>
    String(s ?? '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const payload = [normalise(text), ...options.map(normalise).sort()].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** Fisher–Yates, crypto-seeded. Used for option order, which must not be a tell. */
export function shuffle(array) {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickRandom(array) {
  if (!array?.length) return undefined;
  return array[crypto.randomInt(array.length)];
}
