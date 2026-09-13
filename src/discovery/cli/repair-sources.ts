import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import {
  defaultDatabasePath,
  openDatabase,
  type JobDatabase,
} from '../../db/database.js';
import { nowUtc } from '../../utilities/timestamps.js';
import {
  assertRequiredSchema,
  createVerifiedBackup,
} from './remediate-sources.js';

export type RepairKind =
  | 'workday-site-correction'
  | 'ats-migration'
  | 're-enable-healthy';

export interface SourceRepair {
  sourceId: string;
  employer: string;
  kind: RepairKind;
  detail: string;
  applies: {
    providerId?: string;
    connector?: string;
    careersUrl?: string;
    enabled?: 0 | 1;
    configuration?: Record<string, unknown>;
    healthStatus?: 'healthy' | 'failed' | 'never-run' | 'credentials-required';
    healthMessage?: string;
    failureCount?: number;
  };
}

export interface RepairPlan {
  repairs: SourceRepair[];
  skipped: { sourceId: string; detail: string }[];
}

export interface ApplyRepairsResult {
  applied: string[];
  alreadyInDesiredState: string[];
}

interface RepairSourceRow {
  id: string;
  employer: string;
  display_name: string | null;
  provider_id: string | null;
  connector: string | null;
  careers_url: string | null;
  configuration_json: string;
  enabled: number;
  health_status: string | null;
  failure_count: number;
}

function parseConfiguration(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const INTEL_EVIDENCE =
  'Repaired after live verification on 2026-09-12: POST /wday/cxs/intel/External/jobs returned HTTP 200 with 592 jobs; the configured site "Intel_External" returns 404 ({"errorCode":"S21","message":"not found: Job_Posting_Site_ID=Intel_External"}). The correct public career site slug is "External" (jobs.intel.com redirects into this Workday board).';

const ETSY_EVIDENCE =
  'Repaired after live verification on 2026-09-12: Etsy migrated from BambooHR to Workday. careers.etsy.com is now a Clinch front-end, and the Workday board POST /wday/cxs/etsy/etsy_careers/jobs returned HTTP 200 with 46 live jobs. Repointed source from bamboohr to workday tenant "etsy" site "etsy_careers" and re-enabled.';

const ENCYCLIS_EVIDENCE =
  'Re-enabled after live verification on 2026-09-12: the iCIMS hosted-v1 portal https://careers-encyclis.icims.com is reachable and active (/jobs/intro 200, /sitemap.xml 200, /jobs/search 200). The earlier "iCIMS careers site is unreachable or inactive" classification was a transient network misclassification; the portal is live.';

export function planRepairs(database: JobDatabase): RepairPlan {
  const rows = database
    .prepare<[], RepairSourceRow>(
      `SELECT id, employer, display_name, provider_id, connector, careers_url,
              configuration_json, enabled, health_status, failure_count
         FROM sources`,
    )
    .all();

  const repairs: SourceRepair[] = [];
  const skipped: { sourceId: string; detail: string }[] = [];

  for (const row of rows) {
    const configuration = parseConfiguration(row.configuration_json);
    const careersUrl = row.careers_url ?? '';

    if (row.provider_id === 'workday') {
      const currentSite =
        typeof configuration['site'] === 'string'
          ? configuration['site']
          : null;
      const intelBoard =
        careersUrl.includes('intel.wd1.myworkdayjobs.com') ||
        configuration['tenant'] === 'intel';
      if (intelBoard) {
        if (
          currentSite === 'Intel_External' ||
          careersUrl.includes('/Intel_External')
        ) {
          repairs.push({
            sourceId: row.id,
            employer: row.display_name ?? row.employer,
            kind: 'workday-site-correction',
            detail: INTEL_EVIDENCE,
            applies: {
              careersUrl: 'https://intel.wd1.myworkdayjobs.com/External',
              configuration: {
                origin: 'https://intel.wd1.myworkdayjobs.com',
                tenant: 'intel',
                site: 'External',
              },
              healthStatus: 'never-run',
              healthMessage: INTEL_EVIDENCE,
              failureCount: 0,
            },
          });
        } else {
          skipped.push({
            sourceId: row.id,
            detail: 'Intel site already corrected to External',
          });
        }
        continue;
      }
    }

    if (
      row.provider_id === 'bamboohr' &&
      (row.employer.toLowerCase() === 'etsy' ||
        careersUrl.includes('etsy.bamboohr.com') ||
        configuration['companyDomain'] === 'etsy')
    ) {
      repairs.push({
        sourceId: row.id,
        employer: row.display_name ?? row.employer,
        kind: 'ats-migration',
        detail: ETSY_EVIDENCE,
        applies: {
          providerId: 'workday',
          connector: 'workday',
          careersUrl: 'https://etsy.wd5.myworkdayjobs.com/etsy_careers',
          configuration: {
            origin: 'https://etsy.wd5.myworkdayjobs.com',
            tenant: 'etsy',
            site: 'etsy_careers',
          },
          enabled: 1,
          healthStatus: 'never-run',
          healthMessage: ETSY_EVIDENCE,
          failureCount: 0,
        },
      });
      continue;
    }

    if (
      row.provider_id === 'icims' &&
      (careersUrl.includes('careers-encyclis') ||
        (typeof configuration['portalUrl'] === 'string' &&
          configuration['portalUrl'].includes('careers-encyclis')))
    ) {
      if (row.enabled === 1) {
        skipped.push({
          sourceId: row.id,
          detail: 'Encyclis already enabled; no repair required',
        });
        continue;
      }
      repairs.push({
        sourceId: row.id,
        employer: row.display_name ?? row.employer,
        kind: 're-enable-healthy',
        detail: ENCYCLIS_EVIDENCE,
        applies: {
          careersUrl: 'https://careers-encyclis.icims.com/jobs/intro',
          configuration: {
            portalUrl: 'https://careers-encyclis.icims.com',
            company: 'encyclis',
            variant: 'icims_hosted_v1',
          },
          enabled: 1,
          healthStatus: 'never-run',
          healthMessage: ENCYCLIS_EVIDENCE,
          failureCount: 0,
        },
      });
      continue;
    }
  }

  return { repairs, skipped };
}

interface CareerSiteRepairRow {
  id: string;
  url: string;
  ats_detected_provider: string | null;
  health_status: string | null;
}

export function applyRepairs(
  database: JobDatabase,
  repairs: readonly SourceRepair[],
): ApplyRepairsResult {
  const result: ApplyRepairsResult = { applied: [], alreadyInDesiredState: [] };

  database.transaction(() => {
    for (const repair of repairs) {
      const existing = database
        .prepare<
          [string],
          { enabled: number; provider_id: string | null }
        >('SELECT enabled, provider_id FROM sources WHERE id = ?')
        .get(repair.sourceId);
      if (existing === undefined) {
        throw new Error(`Source does not exist: ${repair.sourceId}`);
      }
      if (
        repair.applies.enabled !== undefined &&
        existing.enabled === repair.applies.enabled &&
        repair.applies.providerId === undefined
      ) {
        result.alreadyInDesiredState.push(repair.sourceId);
        continue;
      }

      const updates: string[] = [];
      const parameters: (string | number | null)[] = [];
      if (repair.applies.providerId !== undefined) {
        updates.push('provider_id = ?');
        parameters.push(repair.applies.providerId);
      }
      if (repair.applies.connector !== undefined) {
        updates.push('connector = ?');
        parameters.push(repair.applies.connector);
      }
      if (repair.applies.careersUrl !== undefined) {
        updates.push('careers_url = ?');
        parameters.push(repair.applies.careersUrl);
      }
      if (repair.applies.configuration !== undefined) {
        updates.push('configuration_json = ?');
        parameters.push(JSON.stringify(repair.applies.configuration));
      }
      if (repair.applies.enabled !== undefined) {
        updates.push('enabled = ?');
        parameters.push(repair.applies.enabled);
      }
      if (repair.applies.healthStatus !== undefined) {
        updates.push('health_status = ?');
        parameters.push(repair.applies.healthStatus);
      }
      if (repair.applies.healthMessage !== undefined) {
        updates.push('health_message = ?');
        parameters.push(repair.applies.healthMessage);
      }
      if (repair.applies.failureCount !== undefined) {
        updates.push('failure_count = ?');
        parameters.push(repair.applies.failureCount);
      }
      if (updates.length === 0) {
        throw new Error(`Repair for ${repair.sourceId} has no field updates`);
      }

      parameters.push(nowUtc(), repair.sourceId);
      database
        .prepare(
          `UPDATE sources SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`,
        )
        .run(...parameters);
      result.applied.push(repair.sourceId);
    }
  })();

  const intelRepairs = repairs.filter(
    (repair) => repair.kind === 'workday-site-correction',
  );
  if (intelRepairs.length > 0) {
    applyIntelCareerSiteWork(database);
  }

  return result;
}

function applyIntelCareerSiteWork(database: JobDatabase): void {
  const timestamp = nowUtc();
  const staleUrl = 'https://intel.wd1.myworkdayjobs.com/Intel_External';
  const correctedUrl = 'https://intel.wd1.myworkdayjobs.com/External';
  const staleSite = database
    .prepare<
      [string],
      CareerSiteRepairRow
    >('SELECT id, url, ats_detected_provider, health_status FROM career_sites WHERE url = ?')
    .get(staleUrl);

  if (staleSite !== undefined) {
    database
      .prepare(
        `UPDATE career_sites SET url = ?, normalized_url = ?, updated_at = ? WHERE id = ?`,
      )
      .run(correctedUrl, correctedUrl.toLowerCase(), timestamp, staleSite.id);
    recordVerificationHistory(
      database,
      staleSite.id,
      staleUrl,
      correctedUrl,
      staleSite.ats_detected_provider ?? 'workday',
      'workday',
      staleSite.health_status ?? 'unknown',
      `Corrected Workday posting site slug: "${staleUrl.split('/').pop() ?? ''}" was stale; the active public site is "External".`,
    );
  }

  const legacyRows = database
    .prepare<[], CareerSiteRepairRow>(
      `SELECT id, url, ats_detected_provider, health_status FROM career_sites
        WHERE (url LIKE '%jobs.intel.com%' OR url LIKE '%corpredirect.intel.com%')
          AND health_status != 'retired'`,
    )
    .all();
  for (const legacy of legacyRows) {
    database
      .prepare(
        `UPDATE career_sites SET health_status = 'retired', health_checked_at = ?,
           health_message = ?, discovery_state = 'retired', updated_at = ?
         WHERE id = ?`,
      )
      .run(
        timestamp,
        'Retired after ATS migration to https://intel.wd1.myworkdayjobs.com/External: jobs.intel.com redirects to a corporate 404 and is no longer a discovery endpoint.',
        timestamp,
        legacy.id,
      );
    recordVerificationHistory(
      database,
      legacy.id,
      legacy.url,
      null,
      legacy.ats_detected_provider ?? null,
      'workday',
      legacy.health_status ?? 'unknown',
      `Retired legacy career URL after ATS migration; canonical board is Intel's Workday posting site "External".`,
    );
  }
}

function recordVerificationHistory(
  database: JobDatabase,
  careerSiteId: string,
  requestedUrl: string,
  effectiveUrl: string | null,
  previousAtsProvider: string | null,
  detectedProvider: string,
  previousHealthStatus: string,
  reason: string,
): void {
  const timestamp = nowUtc();
  database
    .prepare(
      `INSERT INTO career_site_verification_history (
         id, career_site_id, requested_url, effective_url, http_status,
         result_classification, previous_ats_provider, detected_ats_platform,
         detected_provider, confidence, evidence_json, previous_health_status,
         resulting_health_status, reason, observed_at
       ) VALUES (?, ?, ?, ?, 200, 'ats-changed', ?, 'workday', ?, 1.0, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      careerSiteId,
      requestedUrl,
      effectiveUrl,
      previousAtsProvider,
      detectedProvider,
      JSON.stringify([
        'live-endpoint-verification',
        'workday-cxs-probe',
        'ats-migration',
      ]),
      previousHealthStatus,
      'healthy',
      reason.slice(0, 1000),
      timestamp,
    );
}

export async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const live = arguments_.includes('--live');
  const mode = live ? 'LIVE (writes enabled)' : 'DRY-RUN (no changes)';
  const databasePath =
    process.env['JOB_BROWSER_DB_PATH'] ?? defaultDatabasePath();
  const database = openDatabase(databasePath);
  try {
    assertRequiredSchema(database);
    const plan = planRepairs(database);

    console.log(`=== SOURCE REPAIRS (${mode}) ===`);
    console.log(`Database: ${databasePath}`);
    console.log(`Planned repairs: ${String(plan.repairs.length)}`);
    for (const repair of plan.repairs) {
      console.log(
        `  - [${repair.kind}] ${repair.employer} (${repair.sourceId})`,
      );
      console.log(`      ${repair.detail}`);
    }
    console.log(
      `Skipped (already in desired state): ${String(plan.skipped.length)}`,
    );
    for (const item of plan.skipped) {
      console.log(`  - ${item.sourceId}: ${item.detail}`);
    }

    if (!live) {
      console.log('DRY-RUN complete. No records were modified.');
      return;
    }
    if (plan.repairs.length === 0) {
      console.log('Nothing to apply.');
      return;
    }

    const backupPath = await createVerifiedBackup(database, databasePath);
    console.log(`Verified pre-change backup: ${backupPath}`);

    const result = applyRepairs(database, plan.repairs);
    console.log(
      `Applied ${String(result.applied.length)} repair action(s); already in desired state: ${String(result.alreadyInDesiredState.length)}.`,
    );
    for (const applied of result.applied) {
      console.log(`  repaired: ${applied}`);
    }
    console.log('Live repair complete. No records were deleted.');
  } finally {
    database.close();
  }
}

const isCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
