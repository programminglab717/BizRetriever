import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type { GenerateRequest, Usage } from './types';

/**
 * AI replay recordings (ADR-021, ADR-027). A recording is keyed by everything that determines the
 * answer: task, prompt version, model tier, prompts, messages and the output schema. Tests and CI only
 * ever replay; development records once and replays after; the demo replays with a live fallback.
 */
export interface Recording {
  key: string;
  task: string;
  promptVersion: string;
  model: string;
  usage: Usage;
  data: unknown;
  recordedAt: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function recordingKey(request: GenerateRequest<unknown>): string {
  const material = canonical({
    task: request.task,
    promptVersion: request.promptVersion,
    tier: request.tier,
    system: request.system,
    cachedContext: request.cachedContext ?? [],
    messages: request.messages,
    schema: z.toJSONSchema(request.schema),
  });
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

function fileFor(dir: string, task: string, key: string): string {
  return path.join(dir, task.replace(/[^a-z0-9_-]/gi, '_'), `${key.slice(0, 24)}.json`);
}

export function loadRecording(
  dir: string,
  request: GenerateRequest<unknown>,
): Recording | undefined {
  const key = recordingKey(request);
  try {
    const rec = JSON.parse(readFileSync(fileFor(dir, request.task, key), 'utf8')) as Recording;
    return rec.key === key ? rec : undefined;
  } catch {
    return undefined;
  }
}

export function saveRecording(
  dir: string,
  request: GenerateRequest<unknown>,
  rec: Omit<Recording, 'key' | 'task' | 'promptVersion' | 'recordedAt'>,
): void {
  const key = recordingKey(request);
  const file = fileFor(dir, request.task, key);
  mkdirSync(path.dirname(file), { recursive: true });
  const full: Recording = {
    key,
    task: request.task,
    promptVersion: request.promptVersion,
    recordedAt: new Date().toISOString(),
    ...rec,
  };
  writeFileSync(file, `${JSON.stringify(full, null, 2)}\n`);
}
