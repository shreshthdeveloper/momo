import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * SMS delivery, behind an interface so swapping providers is one file.
 *
 * The `console` driver prints the OTP to the server log instead of sending it.
 * That is the right thing in development and a breach in production, so
 * config/env.js refuses to boot a production process configured this way.
 */

const drivers = {
  console: {
    async send({ to, message }) {
      logger.info({ to, message }, '── SMS (console driver) ──');
      return { ok: true, driver: 'console' };
    },
  },

  /**
   * Placeholder for the real integration. Wired the same way for any Indian
   * transactional provider (MSG91, Gupshup, Kaleyra) — they all take a POST
   * with a template id and a destination.
   */
  http: {
    async send({ to, message }) {
      if (!env.SMS_API_KEY) throw new Error('SMS_API_KEY is not configured');
      const res = await fetch(process.env.SMS_ENDPOINT ?? '', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authkey: env.SMS_API_KEY,
        },
        body: JSON.stringify({ to, message, sender: env.SMS_SENDER_ID }),
      });
      if (!res.ok) throw new Error(`SMS provider returned ${res.status}`);
      return { ok: true, driver: 'http' };
    },
  },
};

export async function sendSms({ to, message }) {
  const driver = drivers[env.SMS_PROVIDER] ?? drivers.console;
  try {
    return await driver.send({ to, message });
  } catch (err) {
    logger.error({ err, to }, 'SMS send failed');
    // The caller must not leak provider failures to the client as an OTP
    // problem — the code is stored either way and can be retried.
    return { ok: false, error: err.message };
  }
}

export function otpMessage(code) {
  return `${code} is your Mimo verification code. It expires in 5 minutes. Do not share it with anyone.`;
}
