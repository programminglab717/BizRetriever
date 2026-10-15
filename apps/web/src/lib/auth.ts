import 'server-only';

import { account, getAppDb, session, user, verification } from '@bizr/db';
import { getEnv } from '@bizr/platform';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';

import { sendEmail } from './email';

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
      sendResetPassword: async ({ user: u, url }) => {
        await sendEmail({
          to: u.email,
          subject: 'Reset your BizRetriever password',
          text: `Hi ${u.name},\n\nUse this link to choose a new password:\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user: u, url }) => {
        await sendEmail({
          to: u.email,
          subject: 'Confirm your email for BizRetriever',
          text: `Hi ${u.name},\n\nPlease confirm your email address:\n${url}\n\nThanks!`,
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
