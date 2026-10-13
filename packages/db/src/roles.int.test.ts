import { getEnv } from '@bizr/platform';
import { databaseAvailable } from '@bizr/platform/testing';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const hasDb = await databaseAvailable();

/** Baseline privilege checks for the login roles (ARCHITECTURE §6). Tenant checks arrive in M1. */
describe.skipIf(!hasDb)('database roles (integration)', () => {
  const clients: pg.Client[] = [];
  async function connect(url: string) {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    clients.push(client);
    return client;
  }

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end()));
  });

  it('app role can use control-plane tables', async () => {
    const app = await connect(getEnv().DATABASE_URL_APP);
    await expect(app.query('select count(*) from app.job_run')).resolves.toBeDefined();
  });

  it('app role cannot create schemas', async () => {
    const app = await connect(getEnv().DATABASE_URL_APP);
    await expect(app.query('create schema t_should_not_exist')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('tenant broker role has no access to the control plane', async () => {
    const tenant = await connect(getEnv().DATABASE_URL_TENANT);
    await expect(tenant.query('select count(*) from app.job_run')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('nobody can create objects in the public schema', async () => {
    const tenant = await connect(getEnv().DATABASE_URL_TENANT);
    await expect(tenant.query('create table public.x (id int)')).rejects.toThrow(
      /permission denied/,
    );
  });
});
