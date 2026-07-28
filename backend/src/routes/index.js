import authRoutes from './auth.js';
import meRoutes from './me.js';
import catalogRoutes from './catalog.js';
import configRoutes from './config.js';
import leaderboardRoutes from './leaderboards.js';
import matchRoutes from './matches.js';
import spaceRoutes from './spaces.js';
import socialRoutes from './social.js';
import uploadRoutes from './uploads.js';
import adminRoutes from './admin.js';
import adminLearningRoutes from './adminLearning.js';
import superRoutes from './super.js';
import { registry } from '../game/registry.js';
import { mongoose } from '../config/db.js';
import { PROTOCOL_VERSION, MIN_SUPPORTED_PROTOCOL_VERSION } from '../shared/protocol.js';

export async function registerRoutes(app) {
  // tech.md §14 — the system health view the superadmin portal reads.
  app.get('/health', async () => ({
    status: mongoose.connection.readyState === 1 ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    game: registry.stats(),
    protocol: { current: PROTOCOL_VERSION, minSupported: MIN_SUPPORTED_PROTOCOL_VERSION },
    version: process.env.npm_package_version ?? '1.0.0',
  }));

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(meRoutes);
      await api.register(catalogRoutes);
      // Unauthenticated: the sign-up avatar picker needs the catalogue before
      // there is an account to authenticate. See routes/config.js.
      await api.register(configRoutes);
      await api.register(leaderboardRoutes);
      await api.register(matchRoutes);
      await api.register(spaceRoutes);
      await api.register(socialRoutes);
      await api.register(uploadRoutes);
      await api.register(adminRoutes, { prefix: '/admin' });
      // Phase 3 admin surface, same prefix and same guards — split by job
      // rather than by URL (prd.md §8.5, F8.2.6, F8.6.5).
      await api.register(adminLearningRoutes, { prefix: '/admin' });
      await api.register(superRoutes, { prefix: '/super' });
    },
    { prefix: '/api/v1' },
  );
}
