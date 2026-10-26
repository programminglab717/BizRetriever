import type { Env } from '@bizr/platform';

export interface RoleCredentials {
  name: string;
  password: string;
}

function credentialsFrom(url: string, label: string): RoleCredentials {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`${label}: role name "${name}" must be lowercase letters, digits or _`);
  }
  if (!password) throw new Error(`${label}: connection string must include a password`);
  return { name, password };
}

/** The four login roles, taken from the connection strings so there is one source of truth. */
export function loginRoles(env: Env) {
  if (!env.DATABASE_URL_MIGRATE) throw new Error('DATABASE_URL_MIGRATE is required');
  return {
    owner: credentialsFrom(env.DATABASE_URL_MIGRATE, 'DATABASE_URL_MIGRATE'),
    app: credentialsFrom(env.DATABASE_URL_APP, 'DATABASE_URL_APP'),
    admin: credentialsFrom(env.DATABASE_URL_ADMIN, 'DATABASE_URL_ADMIN'),
    tenant: credentialsFrom(env.DATABASE_URL_TENANT, 'DATABASE_URL_TENANT'),
  };
}

/** The group every per-business login belongs to (ADR-055): `bizr_tenant` → `bizr_tenant_logins`. */
export function loginGroupName(brokerRole: string): string {
  return `${brokerRole}_logins`;
}
