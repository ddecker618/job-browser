import type { JobDatabase } from '../database.js';

export const SEED_SOURCE_ID = '00000000-0000-4000-8000-000000000001';
export const SEED_JOB_ID = '00000000-0000-4000-8000-000000000002';

export function seedKnownApplications(database: JobDatabase): void {
  // Static demo source and job insertion has been disabled to clean up Touchette demo data.
  void database;
}
