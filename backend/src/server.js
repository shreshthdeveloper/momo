import { env, assertProductionConfig } from './config/env.js';
import { connectDb, disconnectDb, ensureIndexes } from './config/db.js';
import { ensurePublicSpace } from './models/index.js';
import { loadProgression } from './services/progressionService.js';
import { ensureMonthlyChests } from './services/chestService.js';
import { buildApp } from './app.js';
import { createSocketGateway } from './game/socketGateway.js';
import { startJobs, stopJobs } from './jobs/index.js';
import { logger } from './lib/logger.js';

/**
 * v1 runs as a single Node process serving REST and sockets (tech.md §12).
 * The game module has no HTTP coupling, so extracting it later is a deployment
 * change rather than a rewrite.
 */
async function main() {
  assertProductionConfig();

  await connectDb();
  await ensurePublicSpace();
  logger.info({ url: env.MONGO_URL.replace(/\/\/.*@/, '//***@') }, 'mongo connected');

  /**
   * The progression config has to be in memory before the first request: a
   * mongoose document method reports an account level synchronously, so there
   * is no point at which it could wait for a read. A fresh install is seeded
   * here from the shipped constants, which is also where existing players have
   * whatever they are wearing grandfathered to them.
   */
  const config = await loadProgression();
  /**
   * The two chests are rolled monthly, and the job that does it only fires
   * while this process is up. Rolling here as well means a fresh install, or
   * one that was down over the 1st, still serves this month's pool rather than
   * last month's — or none at all.
   */
  const { period } = await ensureMonthlyChests();
  logger.info(
    {
      version: config.version,
      cosmetics: config.catalogue.length,
      chests: config.chests.length,
      period,
    },
    'progression loaded',
  );

  // Outside production, keep indexes in step with the schemas automatically.
  // In production this is a deliberate migration step — see config/db.js.
  if (!env.isProd) {
    const { synced, failed } = await ensureIndexes({ log: logger });
    logger.info({ synced, failed }, 'indexes synced');
  }

  const app = await buildApp();
  // `ready()` before attaching Socket.IO so the underlying HTTP server exists.
  // Fastify and Socket.IO then share it — one port, one process.
  await app.ready();

  const { orchestrator } = createSocketGateway(app.server);
  app.orchestrator = orchestrator;

  if (env.ENABLE_JOBS) startJobs();

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, sms: env.SMS_PROVIDER, storage: env.STORAGE_DRIVER },
    'mimo api listening',
  );

  /**
   * tech.md §16 — the game process drains gracefully: stop accepting new
   * matches, wait for live ones to finish, then cycle. A deploy that kills
   * matches mid-round is the one thing players will not forgive.
   */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'draining — no new matches, finishing live ones');

    stopJobs();
    try {
      await orchestrator.drain({ timeoutMs: 45_000 });
      await app.close();
      await disconnectDb();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
