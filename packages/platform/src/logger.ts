import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { pino, type Logger } from 'pino';

import { getEnv } from './env';

interface LogContext {
  correlationId: string;
  workspaceId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

let root: Logger | undefined;

function rootLogger(): Logger {
  root ??= pino({
    level: getEnv().LOG_LEVEL,
    base: { service: process.env.BIZR_SERVICE ?? 'bizretriever' },
    // Attach the current correlation id (and workspace) to every log line.
    mixin: () => {
      const ctx = storage.getStore();
      return ctx ? { ...ctx } : {};
    },
    redact: ['password', '*.password', 'authorization', '*.authorization', 'apiKey', '*.apiKey'],
  });
  return root;
}

/** Logger for a module, e.g. `getLogger('jobs')`. */
export function getLogger(module: string): Logger {
  return rootLogger().child({ module });
}

/** Runs `fn` with a correlation id that appears on every log line written inside it. */
export function withLogContext<T>(ctx: Partial<LogContext>, fn: () => T): T {
  const parent = storage.getStore();
  return storage.run(
    {
      ...parent,
      ...ctx,
      correlationId: ctx.correlationId ?? parent?.correlationId ?? randomUUID(),
    },
    fn,
  );
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
