import type { Catalog } from '../translate';
import { ask } from './ask';
import { common } from './common';
import { core } from './core';
import { data } from './data';
import { insights } from './insights';
import { packs } from './packs';
import { settings } from './settings';
import { shell } from './shell';

/**
 * Spanish (M20). Written for any Spanish speaker: neutral wording, "tú", no regional slang. A
 * native speaker's review is still to come (OPEN_QUESTIONS Q31).
 *
 * One file per area of the app; a key may appear in several files only with the same translation
 * (`catalog.test.ts`).
 */
export const parts: Record<string, Catalog> = {
  common,
  shell,
  data,
  ask,
  insights,
  settings,
  core,
  packs,
};

export const es: Catalog = Object.assign({}, ...Object.values(parts)) as Catalog;
