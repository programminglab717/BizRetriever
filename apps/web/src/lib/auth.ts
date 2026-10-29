import 'server-only';

import { account, getAppDb, session, user, verification } from '@bizr/db';
import { getEnv } from '@bizr/platform';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

import { userLanguage } from '@bizr/core/workspaces';
import { pickLanguage, translator, type Language } from '@bizr/i18n';

import { sendEmail } from './email';

/** A person's own language, else their browser's (M20): account emails come before any business. */
async function emailLanguage(userId: string, request?: Request): Promise<Language> {
  return (
    (await userLanguage(userId).catch(() => null)) ??
    pickLanguage(request?.headers.get('accept-language'))
  );
}

export function isGoogleEnabled(): boolean {
  const env = getEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    appName: 'BizRetriever',
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getAppDb(), {
      provider: 'pg',
      schema: { user, session, account, verification },
    }),
    advanced: { database: { generateId: 'uuid' } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: true,
      // Verification is encouraged but never blocks getting to the "wow" moment (PRODUCT_SPEC §1.1).
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }, request) => {
        const t = translator(await emailLanguage(u.id, request));
        await sendEmail({
          to: u.email,
          subject: t('Reset your BizRetriever password'),
          text: t(
            "Hi {name},\n\nUse this link to choose a new password:\n{url}\n\nIf you didn't ask for this, you can ignore this email.",
            { name: u.name, url },
          ),
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: u, url }, request) => {
        const t = translator(await emailLanguage(u.id, request));
        await sendEmail({
          to: u.email,
          subject: t('Confirm your email for BizRetriever'),
          text: t('Hi {name},\n\nPlease confirm your email address:\n{url}\n\nThanks!', {
            name: u.name,
            url,
          }),
        });
      },
    },
    socialProviders: isGoogleEnabled()
      ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
      : {},
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    rateLimit: { enabled: env.AUTH_RATE_LIMIT === 'on', window: 60, max: 100 },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as typeof globalThis & { bizrAuth?: Auth };

/** Created lazily so importing this module never needs env vars (e.g. during `next build`). */
export function getAuth(): Auth {
  globalForAuth.bizrAuth ??= createAuth();
  return globalForAuth.bizrAuth;
}
