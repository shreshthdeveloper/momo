import mongoose from 'mongoose';
import { env } from './env.js';

mongoose.set('strictQuery', true);
// tech.md §15 — strict mode on, so a stray field in a user payload can never
// reach a document.
mongoose.set('strict', true);

/**
 * `sanitizeFilter` is deliberately NOT enabled globally.
 *
 * It rewrites any object-valued filter as `{ $eq: value }`, which breaks every
 * legitimate `$in` / `$gte` / `$nin` this codebase relies on — the home feed,
 * leaderboards and question selection all use them. Turning it on globally
 * trades real query bugs for a defence that is already covered twice over:
 *
 *   1. Fastify validates every route against a JSON schema with
 *      `removeAdditional: 'all'` and `coerceTypes: false`, so an operator
 *      object submitted where a string is expected is rejected before a
 *      handler sees it (app.js).
 *   2. No raw request object is ever spread into a filter. Ids go through
 *      `isValidObjectId` and an explicit `ObjectId` cast; free text is regex
 *      escaped at the call site.
 *
 * That is what tech.md §15 asks for: "no raw user objects passed to queries".
 */

let connected = false;

export async function connectDb(url = env.MONGO_URL) {
  if (connected) return mongoose.connection;
  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 20,
  });
  connected = true;
  return mongoose.connection;
}

export async function disconnectDb() {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

/**
 * Reconcile every collection's indexes with its schema.
 *
 * `syncIndexes` also DROPS indexes the schema no longer declares, which is the
 * point — an index that changed shape (say from unique on one field to unique
 * on a pair) otherwise stays as it was for the life of the database, and the
 * symptom shows up much later as writes silently failing.
 *
 * Called on boot outside production. In production the same call is made
 * deliberately as part of a migration step, because building an index on a
 * large live collection is a decision, not a side effect of a restart.
 */
export async function ensureIndexes({ log } = {}) {
  const models = mongoose.modelNames().map((n) => mongoose.model(n));
  const results = await Promise.allSettled(models.map((m) => m.syncIndexes()));
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? { model: models[i].modelName, err: r.reason } : null))
    .filter(Boolean);
  if (failed.length && log) {
    for (const f of failed) log.warn({ err: f.err, model: f.model }, 'index sync failed');
  }
  return { synced: results.length - failed.length, failed: failed.length };
}

export { mongoose };
