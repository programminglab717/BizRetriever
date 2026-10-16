import type { PackMetrics } from './metrics';
import type { PackDashboard } from './dashboard';
import type { PackQuestion } from './questions';
import type { KnownFormat, PackEntity, PackManifest, PackSynonyms } from './schema';

/** A validated pack, as the application uses it. */
export interface PackData {
  manifest: PackManifest;
  entities: PackEntity[];
  synonyms: PackSynonyms;
  knownFormats: KnownFormat[];
  metrics: PackMetrics;
  questions: PackQuestion[];
  dashboard: PackDashboard;
  /** Short industry primer added to AI system prompts (reviewed like code). */
  primer: string;
}
