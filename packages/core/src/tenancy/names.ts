import { randomBytes } from 'node:crypto';

import { isSafeIdentifier } from '../sql/ident';

/** Postgres object names for one tenant (ARCHITECTURE §6). */
export interface TenantNames {
  schema: string;
  snapshotSchema: string;
  readerRole: string;
  writerRole: string;
  /** The business's own database login (ADR-055): may become reader or writer, nothing else. */
  loginRole: string;
}

const TENANT_SCHEMA = /^t_[a-z0-9]{10}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A new random tenant schema name like `t_k3v9q0x2ma`. */
export function newTenantSchemaName(): string {
  const bytes = randomBytes(10);
  let id = '';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return `t_${id}`;
}

export function tenantNames(schema: string): TenantNames {
  if (!TENANT_SCHEMA.test(schema)) throw new Error(`Invalid tenant schema name: ${schema}`);
  const names = {
    schema,
    snapshotSchema: `${schema}_snap`,
    readerRole: `${schema}_reader`,
    writerRole: `${schema}_writer`,
    loginRole: `${schema}_login`,
  };
  for (const n of Object.values(names)) {
    if (!isSafeIdentifier(n)) throw new Error(`Invalid tenant object name: ${n}`);
  }
  return names;
}
