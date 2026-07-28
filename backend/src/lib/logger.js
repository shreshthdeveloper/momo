import { pino } from 'pino';
import { env } from '../config/env.js';

/** tech.md §14 — structured JSON. Pretty only in development. */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'mimo-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.otp',
      '*.code',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      '*.codeHash',
      '*.tokenHash',
    ],
    censor: '[redacted]',
  },
  ...(env.isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
      }
    : {}),
});

/** tech.md §14 — every match logs one summary record on completion. */
export function logMatchSummary(summary) {
  logger.info(
    {
      evt: 'match.complete',
      matchId: summary.matchId,
      topicId: String(summary.topicId),
      spaceId: String(summary.spaceId),
      mode: summary.mode,
      durationMs: summary.completedAt - summary.startedAt,
      rounds: summary.rounds.length,
      hadGhost: summary.players.some((p) => p.isGhost),
      abandoned: Boolean(summary.abandonedBy),
      scores: summary.players.map((p) => p.score),
      flags: summary.players.reduce((sum, p) => sum + (p.flags ?? 0), 0),
    },
    'match complete',
  );
}
