import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  scoringConfigSchema,
  type ScoringConfig,
} from '../schemas/scoring-config.js';

export function loadScoringConfig(
  configPath = resolve(process.cwd(), 'config', 'scoring-config.json'),
): ScoringConfig {
  try {
    const contents = readFileSync(configPath, 'utf8');
    return scoringConfigSchema.parse(JSON.parse(contents) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load scoring configuration at ${configPath}: ${message}`,
      {
        cause: error,
      },
    );
  }
}
