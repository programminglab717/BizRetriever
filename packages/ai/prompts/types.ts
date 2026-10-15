import type { ChatMessage } from '../src/types';

/** A released prompt. Immutable once released: changes go in a new version file. */
export interface PromptDef<Input> {
  task: string;
  /** e.g. "propose_data_model@v1". Logged with every call and part of the replay key. */
  version: string;
  system: string;
  build(input: Input): { cachedContext: string[]; messages: ChatMessage[] };
}

/** The pack's record types as the AI sees them. Built by code from the pack (trusted). */
export interface PackCatalog {
  entities: {
    id: string;
    label: string;
    description: string;
    naturalKeys: string[][];
    fields: {
      id: string;
      label: string;
      type: string;
      required?: boolean;
      references?: string;
      allowedValues?: string[];
      description?: string;
    }[];
  }[];
  /** "entity.field" → header words that usually mean it. */
  headerSynonyms: Record<string, string[]>;
  knownFormats: { id: string; label: string; headers: string[] }[];
}

export interface WorkspaceSettings {
  currency: string;
  dateOrder: 'DMY' | 'MDY' | 'YMD';
  /** YYYY-MM-DD in the workspace time zone. */
  today: string;
}
