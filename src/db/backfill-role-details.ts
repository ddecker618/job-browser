import type { JobDatabase } from './database.js';
import type { ScoringConfig } from '../schemas/scoring-config.js';
import { ROLE_DETAILS_VERSION } from '../schemas/role-details.js';
import { extractRoleDetails } from '../intelligence/roleDetailsExtractor.js';
import { IntelligenceRepository } from '../database/intelligenceRepository.js';
import type { RoleDetailsInput } from '../intelligence/roleDetailsExtractor.js';

interface BackfillJobRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  city: string | null;
  state: string | null;
  remote_type: string;
  telework_eligible: number | null;
  employment_type: string;
  work_schedule: string | null;
  appointment_type: string | null;
  description: string | null;
  requirements: string | null;
  preferred_qualifications: string | null;
}

export const ROLE_DETAILS_BACKFILL_BATCH_SIZE = 200;

export interface RoleDetailsBackfillResult {
  processed: number;
  updated: number;
  skippedCurrentVersion: number;
  version: string;
}

export function backfillRoleDetails(
  database: JobDatabase,
  config: ScoringConfig,
  batchSize = ROLE_DETAILS_BACKFILL_BATCH_SIZE,
): RoleDetailsBackfillResult {
  const intelligence = new IntelligenceRepository(database);
  const rows = database
    .prepare<[string, number], BackfillJobRow>(
      `SELECT id, title, company, location, city, state, remote_type,
              telework_eligible, employment_type, work_schedule, appointment_type,
              description, requirements, preferred_qualifications
         FROM jobs
        WHERE active = 1 AND status <> 'expired'
          AND (role_details_json IS NULL
               OR json_extract(role_details_json, '$.version') IS NULL
               OR json_extract(role_details_json, '$.version') <> ?)
        ORDER BY last_seen_at DESC
        LIMIT ?`,
    )
    .all(ROLE_DETAILS_VERSION, batchSize);

  let updated = 0;
  for (const row of rows) {
    const input: RoleDetailsInput = {
      title: row.title,
      company: row.company,
      location: row.location,
      city: row.city,
      state: row.state,
      remoteType: row.remote_type as RoleDetailsInput['remoteType'],
      teleworkEligible:
        row.telework_eligible === null ? null : Boolean(row.telework_eligible),
      employmentType: row.employment_type as RoleDetailsInput['employmentType'],
      workSchedule: row.work_schedule,
      appointmentType: row.appointment_type,
      description: row.description,
      requirements: row.requirements,
      preferredQualifications: row.preferred_qualifications,
    };
    const details = extractRoleDetails(input, config);
    intelligence.backfillRoleDetails(row.id, JSON.stringify(details));
    updated += 1;
  }

  const totalCurrentVersion = database
    .prepare<[string], { count: number }>(
      `SELECT COUNT(*) AS count FROM jobs
        WHERE active = 1 AND status <> 'expired'
          AND json_extract(role_details_json, '$.version') = ?`,
    )
    .get(ROLE_DETAILS_VERSION)?.count ?? 0;

  return {
    processed: rows.length,
    updated,
    skippedCurrentVersion: totalCurrentVersion,
    version: ROLE_DETAILS_VERSION,
  };
}
