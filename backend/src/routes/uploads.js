import { authenticate } from '../middleware/auth.js';
import { storeImage } from '../services/storageService.js';
import { BadRequestError } from '../lib/errors.js';

const ok = (data) => ({ data });

const KINDS = new Set(['avatar', 'banner', 'cover', 'question', 'logo']);

export default async function uploadRoutes(app) {
  app.addHook('preHandler', authenticate);

  /**
   * tech.md §15 — uploads validated by content type and size, with the actual
   * bytes sniffed rather than the declared mimetype trusted. See
   * services/storageService.js.
   */
  app.post(
    '/uploads/:kind',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request) => {
      const kind = request.params.kind;
      if (!KINDS.has(kind)) throw new BadRequestError('Unknown upload kind.');

      const file = await request.file();
      if (!file) throw new BadRequestError('No file received.', 'NO_FILE');

      const buffer = await file.toBuffer();
      const stored = await storeImage(buffer, { kind, declaredMime: file.mimetype });
      return ok(stored);
    },
  );
}
