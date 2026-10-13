import { describe, expect, it } from 'vitest';

import { envSchema } from './env';

const base = {
  DATABASE_URL_APP: 'postgres://bizr_app:pw@localhost:5432/db',
  DATABASE_URL_ADMIN: 'postgres://bizr_admin:pw@localhost:5432/db',
  DATABASE_URL_TENANT: 'postgres://bizr_tenant:pw@localhost:5432/db',
};

describe('envSchema', () => {
  it('applies defaults', () => {
    const env = envSchema.parse(base);
    expect(env.JOB_RUNNER).toBe('worker');
    expect(env.JOB_STEP_BUDGET_MS).toBe(45_000);
    expect(env.APP_URL).toBe('http://localhost:3000');
  });

  it('coerces numeric strings', () => {
    expect(envSchema.parse({ ...base, JOB_STEP_BUDGET_MS: '5000' }).JOB_STEP_BUDGET_MS).toBe(5000);
  });

  it('rejects non-postgres database urls', () => {
    expect(envSchema.safeParse({ ...base, DATABASE_URL_APP: 'mysql://x' }).success).toBe(false);
  });

  it('requires the drain secret to be long enough when set', () => {
    expect(envSchema.safeParse({ ...base, JOB_DRAIN_SECRET: 'short' }).success).toBe(false);
  });
});
