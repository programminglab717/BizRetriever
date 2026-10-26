import { getEnv } from './env';
import { getLogger } from './logger';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Extra headers, such as List-Unsubscribe. */
  headers?: Record<string, string>;
}

/** Where emails go instead of Resend, in tests. */
type Transport = (email: Email) => Promise<void>;
let transport: Transport | null = null;

/** For tests: capture emails rather than log or send them. Pass null to stop. */
export function setEmailTransport(t: Transport | null): void {
  transport = t;
}

/**
 * Sends an email through Resend (free tier). Zero-cost rule (ADR-026): without RESEND_API_KEY it is
 * written to the log instead (local development), so nothing ever blocks on email delivery.
 * Returns whether it was sent or only logged.
 */
export async function sendEmail(email: Email): Promise<'sent' | 'logged'> {
  if (transport) {
    await transport(email);
    return 'sent';
  }
  const env = getEnv();
  const log = getLogger('email');
  if (!env.RESEND_API_KEY) {
    log.info(
      { to: email.to, subject: email.subject, text: email.text },
      'email (not sent: no RESEND_API_KEY)',
    );
    return 'logged';
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      ...(email.html ? { html: email.html } : {}),
      ...(email.headers ? { headers: email.headers } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    log.error({ status: res.status, body: await res.text() }, 'email send failed');
    throw new Error('Email could not be sent');
  }
  return 'sent';
}
