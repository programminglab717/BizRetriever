import 'server-only';

import { getEnv, getLogger } from '@bizr/platform';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends a transactional email. Zero-cost rule (ADR-026): without RESEND_API_KEY the email is written
 * to the server log instead (local development), so nothing ever blocks on email delivery.
 */
export async function sendEmail(email: Email): Promise<void> {
  const env = getEnv();
  const log = getLogger('email');
  if (!env.RESEND_API_KEY) {
    log.info(
      { to: email.to, subject: email.subject, text: email.text },
      'email (not sent: no RESEND_API_KEY)',
    );
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!res.ok) {
    log.error({ status: res.status, body: await res.text() }, 'email send failed');
    throw new Error('Email could not be sent');
  }
}
