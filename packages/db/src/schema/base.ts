import { pgSchema } from 'drizzle-orm/pg-core';

/** Control-plane schema (ARCHITECTURE §4). Tenant data never lives here. */
export const app = pgSchema('app');
