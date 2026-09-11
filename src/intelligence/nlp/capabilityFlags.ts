import { z } from 'zod';

import type { JobDatabase } from '../../db/database.js';

export const NLP_CAPABILITY_FLAGS_SETTING = 'nlp_capability_flags';
export const NLP_CAPABILITY_FLAGS_VERSION = 'nlp-capability-flags-v1';

const flagsSchema = z.strictObject({
  version: z.literal(NLP_CAPABILITY_FLAGS_VERSION),
  jobIntelligenceExplanation: z.boolean(),
  roleFamilySuggestion: z.boolean(),
  searchTieBreak: z.boolean(),
  searchProfileFeedback: z.boolean(),
});

export type NlpCapabilityFlags = z.infer<typeof flagsSchema>;

export const DEFAULT_NLP_CAPABILITY_FLAGS: NlpCapabilityFlags = {
  version: NLP_CAPABILITY_FLAGS_VERSION,
  jobIntelligenceExplanation: false,
  roleFamilySuggestion: false,
  searchTieBreak: false,
  searchProfileFeedback: false,
};

export function readNlpCapabilityFlags(
  database: JobDatabase,
): NlpCapabilityFlags {
  const row = database
    .prepare<
      [string],
      { setting_value_json: string }
    >('SELECT setting_value_json FROM app_settings WHERE setting_key=?')
    .get(NLP_CAPABILITY_FLAGS_SETTING);
  if (!row) return { ...DEFAULT_NLP_CAPABILITY_FLAGS };
  try {
    return flagsSchema.parse(JSON.parse(row.setting_value_json) as unknown);
  } catch {
    return { ...DEFAULT_NLP_CAPABILITY_FLAGS };
  }
}

export function capabilityEnabled(
  database: JobDatabase,
  capability: Exclude<keyof NlpCapabilityFlags, 'version'>,
): boolean {
  return readNlpCapabilityFlags(database)[capability];
}
