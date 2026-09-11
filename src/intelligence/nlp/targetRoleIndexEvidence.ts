import type { JobDatabase } from '../../db/database.js';
import { validatedSearchIndexEvidence } from './searchIndexEvidence.js';

/** Indexed skills explain already-matched roles; they never widen membership. */
export function targetRoleIndexEvidence(
  database: JobDatabase,
  ids: readonly string[],
): Map<
  string,
  {
    skill: string;
    evidence: string;
    sourceField: string;
    charStart: number;
    charEnd: number;
  }[]
> {
  const result = new Map<
    string,
    {
      skill: string;
      evidence: string;
      sourceField: string;
      charStart: number;
      charEnd: number;
    }[]
  >();
  for (const [jobId, index] of validatedSearchIndexEvidence(database, ids)) {
    const skills = index.evidence.flatMap((item) =>
      item.category === 'skill'
        ? [
            {
              skill: item.label,
              evidence: item.evidence,
              sourceField: item.sourceField,
              charStart: item.charStart,
              charEnd: item.charEnd,
            },
          ]
        : [],
    );
    if (skills.length > 0) result.set(jobId, skills);
  }
  return result;
}
