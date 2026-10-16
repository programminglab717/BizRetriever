import type { PackMetrics } from './metrics';
import type { PackDashboard } from './dashboard';
import type { PackInsights } from './insights';
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
  insights: PackInsights;
  /** Short industry primer added to AI system prompts (reviewed like code). */
  primer: string;
}
