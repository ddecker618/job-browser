import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';

import {
  defaultDatabasePath,
  openDatabase,
  type JobDatabase,
} from '../../db/database.js';
import {
  atsTenantIdentity,
  normalizeUrlIdentity,
} from '../../domain/urlIdentity.js';
import { nowUtc } from '../../utilities/timestamps.js';

export const PROTECTED_PROVIDER_IDS: readonly string[] = [
  'wellfound',
  'ziprecruiter',
  'usajobs',
  'linkedin',
  'dice',
  'indeed',
  'handshake',
];

const CHRONIC_FAILURE_MIN_RUNS = 3;
const CATEGORICALLY_UNREACHABLE_PATTERN = /is unreachable or inactive/i;
const MAX_HEALTH_MESSAGE_LENGTH = 500;

const WORKDAY_FAMILY_PROVIDERS = new Set(['workday', 'cisco', 'crowdstrike']);
const DUPLICATE_SCOPE_PROVIDERS = new Set<string>([
  ...WORKDAY_FAMILY_PROVIDERS,
  'icims',
]);

const HARDCODED_WORKDAY_TENANTS: Record<string, string> = {
  cisco: 'workday:cisco:cisco_careers',
  crowdstrike: 'workday:crowdstrike:crowdstrikecareers',
};

const BACKUP_VERIFIED_TABLES: readonly string[] = [
  'sources',
  'jobs',
  'applications',
  'job_observations',
  'application_history',
];

export type RemediationRule =
  | 'chronic-categorical-failure'
  | 'duplicate-ats-tenant'
  | 'retired-career-site';

export interface RemediationAction {
  sourceId: string;
  employer: string;
  providerId: string;
  rules: RemediationRule[];
  reason: string;
}

export interface RemediationReportItem {
  kind: 'protected-source' | 'career-site-note';
  subject: string;
  detail: string;
  recommendation: string;
}

export interface RemediationPlan {
  actions: RemediationAction[];
  reportOnly: RemediationReportItem[];
}

export interface ApplyResult {
  applied: { sourceId: string; reason: string }[];
  alreadyDisabled: string[];
}

interface EnabledSourceRow {
  id: string;
  employer: string;
  display_name: string | null;
  provider_id: string | null;
  careers_url: string | null;
  configuration_json: string;
  health_status: string | null;
  health_message: string | null;
  failure_count: number;
}

export function assertRequiredSchema(database: JobDatabase): void {
  const required = ['sources', 'runs', 'job_sources', 'career_sites'];
  for (const table of required) {
    const row = database
      .prepare<
        [string],
        { name: string }
      >("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
    if (row === undefined) {
      throw new Error(
        `Database is missing required table "${table}". The database is behind migration head; start the desktop application once or run "npm run db:migrate" against this database first.`,
      );
    }
  }
}

export function planRemediation(database: JobDatabase): RemediationPlan {
  const sources = database
    .prepare<
      [],
      EnabledSourceRow
    >(`SELECT id, employer, display_name, provider_id, careers_url, configuration_json, health_status, health_message, failure_count FROM sources WHERE enabled = 1`)
    .all();

  const linkedSiteSourceIds = new Set(
    database
      .prepare<[], { source_id: string }>(
        'SELECT DISTINCT source_id FROM career_sites WHERE source_id IS NOT NULL',
      )
      .all()
      .map((row) => row.source_id),
  );

  const actions = new Map<string, RemediationAction>();
  const reportOnly: RemediationReportItem[] = [];

  const addAction = (
    row: EnabledSourceRow,
    rule: RemediationRule,
    reason: string,
  ): void => {
    const existing = actions.get(row.id);
    if (existing === undefined) {
      actions.set(row.id, {
        sourceId: row.id,
        employer: row.display_name ?? row.employer,
        providerId: row.provider_id ?? '',
        rules: [rule],
        reason,
      });
      return;
    }
    if (!existing.rules.includes(rule)) existing.rules.push(rule);
    existing.reason = `${existing.reason} ${reason}`;
  };

  for (const row of sources) {
    const providerId = row.provider_id ?? '';
    if (!PROTECTED_PROVIDER_IDS.includes(providerId)) continue;
    const consecutive = countLeadingFailures(database, row.id);
    const linkedJobs = countLinkedJobs(database, row.id);
    reportOnly.push({
      kind: 'protected-source',
      subject: row.display_name ?? row.employer,
      detail: `provider=${providerId}, health=${row.health_status ?? 'unknown'}, failure_count=${String(row.failure_count)}, recent_consecutive_failures=${String(consecutive)}, linked_jobs=${String(linkedJobs)}`,
      recommendation: recommendationForProvider(providerId),
    });
  }

  for (const row of sources) {
    const providerId = row.provider_id ?? '';
    if (PROTECTED_PROVIDER_IDS.includes(providerId)) continue;
    if ((row.health_status ?? '') !== 'failed') continue;
    const consecutive = countLeadingFailures(database, row.id);
    if (consecutive < CHRONIC_FAILURE_MIN_RUNS) continue;
    const message = latestFailureMessage(database, row) ?? '';
    if (!CATEGORICALLY_UNREACHABLE_PATTERN.test(message)) continue;
    addAction(
      row,
      'chronic-categorical-failure',
      truncateReason(
        `Disabled by controlled discovery cleanup (chronic-categorical-failure): ${String(consecutive)} consecutive failed discovery runs and the latest failure classifies the target as categorically unreachable ("${message.trim()}"). Re-enable only after the connector can reach this target reliably.`,
      ),
    );
  }

  const duplicateGroups = groupDuplicateTenantSources(sources);
  for (const group of duplicateGroups) {
    if (group.length < 2) continue;
    const keeper = selectGroupKeeper(database, group, linkedSiteSourceIds);
    for (const member of group) {
      if (member.row.id === keeper.row.id) continue;
      if (PROTECTED_PROVIDER_IDS.includes(member.row.provider_id ?? '')) {
        continue;
      }
      addAction(
        member.row,
        'duplicate-ats-tenant',
        truncateReason(
          `Disabled by controlled discovery cleanup (duplicate-ats-tenant): shares ATS tenant identity "${member.keys.join('/')}" with retained source ${keeper.row.id} (${keeper.row.display_name ?? keeper.row.employer}). Consolidated to avoid redundant discovery load and split attribution.`,
        ),
      );
    }
  }

  const retiredLinks = database
    .prepare<
      [],
      { source_id: string; url: string; health_message: string | null }
    >(`SELECT cs.source_id, cs.url, cs.health_message FROM career_sites cs WHERE cs.health_status = 'retired' AND cs.source_id IS NOT NULL`)
    .all();
  for (const link of retiredLinks) {
    const row = sources.find((candidate) => candidate.id === link.source_id);
    if (row === undefined) continue;
    if (PROTECTED_PROVIDER_IDS.includes(row.provider_id ?? '')) continue;
    addAction(
      row,
      'retired-career-site',
      truncateReason(
        `Disabled by controlled discovery cleanup (retired-career-site): linked career site ${link.url} is retired${link.health_message === null ? '' : ` (${link.health_message})`}.`,
      ),
    );
  }

  const siteNotes = database
    .prepare<
      [],
      {
        url: string;
        health_status: string;
        health_message: string | null;
        source_id: string | null;
      }
    >(
      `SELECT cs.url, cs.health_status, cs.health_message, cs.source_id FROM career_sites cs WHERE cs.health_status IN ('broken', 'warning') ORDER BY cs.health_status, cs.url`,
    )
    .all();
  const enabledSourceById = new Map(sources.map((row) => [row.id, row]));
  for (const site of siteNotes) {
    if (site.source_id !== null) {
      if (enabledSourceById.has(site.source_id)) continue;
    }
    reportOnly.push({
      kind: 'career-site-note',
      subject: site.url,
      detail: `${site.health_status}: ${site.health_message ?? 'no message'}`,
      recommendation:
        'No reliable connector disposition exists for this site yet. Verify the careers URL or update the employer seed manifest; do not create a Source until detection confirms a supported ATS.',
    });
  }

  return { actions: [...actions.values()], reportOnly };
}

export function applyRemediationActions(
  database: JobDatabase,
  actions: readonly RemediationAction[],
): ApplyResult {
  const result: ApplyResult = { applied: [], alreadyDisabled: [] };
  const update = database.prepare(
    'UPDATE sources SET enabled = 0, health_message = ?, updated_at = ? WHERE id = ? AND enabled = 1',
  );
  database.transaction(() => {
    for (const action of actions) {
      const row = database
        .prepare<
          [string],
          { provider_id: string | null; enabled: number }
        >('SELECT provider_id, enabled FROM sources WHERE id = ?')
        .get(action.sourceId);
      if (row === undefined) {
        throw new Error(`Source does not exist: ${action.sourceId}`);
      }
      if (PROTECTED_PROVIDER_IDS.includes(row.provider_id ?? '')) {
        throw new Error(
          `Refusing to disable protected source ${action.sourceId} (provider ${row.provider_id ?? 'unknown'})`,
        );
      }
      if (row.enabled !== 1) {
        result.alreadyDisabled.push(action.sourceId);
        continue;
      }
      update.run(truncateReason(action.reason), nowUtc(), action.sourceId);
      result.applied.push({ sourceId: action.sourceId, reason: action.reason });
    }
  })();
  return result;
}

export async function createVerifiedBackup(
  live: JobDatabase,
  liveDatabasePath: string,
): Promise<string> {
  const backupDir = resolve(dirname(liveDatabasePath), '..', 'backups');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `pre-source-remediation-${stamp}.sqlite`);
  await live.backup(backupPath);

  const verification = new Database(backupPath, { readonly: true });
  try {
    const integrity = verification.pragma('integrity_check', {
      simple: true,
    });
    if (integrity !== 'ok') {
      throw new Error(`Backup failed integrity_check: ${String(integrity)}`);
    }
    for (const table of BACKUP_VERIFIED_TABLES) {
      const liveCount =
        live
          .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
          .get()?.n ?? -1;
      const backupCount =
        verification
          .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
          .get()?.n ?? -2;
      if (liveCount !== backupCount) {
        throw new Error(
          `Backup verification failed for ${table}: live=${String(liveCount)} backup=${String(backupCount)}`,
        );
      }
    }
  } finally {
    verification.close();
  }
  return backupPath;
}

function countLeadingFailures(database: JobDatabase, sourceId: string): number {
  const runs = database
    .prepare<
      [string, number],
      { status: string }
    >('SELECT status FROM runs WHERE source_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(sourceId, 10);
  let consecutive = 0;
  for (const run of runs) {
    if (run.status !== 'failed') break;
    consecutive += 1;
  }
  return consecutive;
}

function countLinkedJobs(database: JobDatabase, sourceId: string): number {
  return (
    database
      .prepare<
        [string],
        { n: number }
      >('SELECT COUNT(*) AS n FROM job_sources WHERE source_id = ?')
      .get(sourceId)?.n ?? 0
  );
}

function latestFailureMessage(
  database: JobDatabase,
  row: EnabledSourceRow,
): string | null {
  if (row.health_message !== null && row.health_message.length > 0) {
    return row.health_message;
  }
  const run = database
    .prepare<
      [string],
      { error_message: string | null }
    >("SELECT error_message FROM runs WHERE source_id = ? AND status = 'failed' ORDER BY started_at DESC LIMIT 1")
    .get(row.id);
  return run?.error_message ?? null;
}

interface TenantKeyedSource {
  row: EnabledSourceRow;
  keys: string[];
}

function groupDuplicateTenantSources(
  sources: readonly EnabledSourceRow[],
): TenantKeyedSource[][] {
  const keyed: TenantKeyedSource[] = [];
  for (const row of sources) {
    const providerId = row.provider_id ?? '';
    if (!DUPLICATE_SCOPE_PROVIDERS.has(providerId)) continue;
    const keys = tenantKeysFor(row);
    if (keys.length === 0) continue;
    keyed.push({ row, keys });
  }

  const groups: TenantKeyedSource[][] = keyed.map((entry) => [entry]);
  const sharesKey = (a: TenantKeyedSource, b: TenantKeyedSource): boolean =>
    a.keys.some((key) => b.keys.includes(key));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const left = groups[i];
        const right = groups[j];
        if (left === undefined || right === undefined) continue;
        if (left.some((a) => right.some((b) => sharesKey(a, b)))) {
          left.push(...right);
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return groups;
}

function tenantKeysFor(row: EnabledSourceRow): string[] {
  const providerId = row.provider_id ?? '';
  const configuration = parseConfiguration(row.configuration_json);
  const keys: string[] = [];
  const tenantIdentity = atsTenantIdentity(providerId, configuration);
  if (tenantIdentity !== null) {
    keys.push(tenantIdentity.toLowerCase());
  }
  const hardcoded = HARDCODED_WORKDAY_TENANTS[providerId];
  if (hardcoded !== undefined) keys.push(hardcoded);
  if (providerId === 'icims') {
    const portalUrl =
      typeof configuration['portalUrl'] === 'string'
        ? configuration['portalUrl']
        : null;
    const normalizedPortal =
      portalUrl === null ? null : normalizeUrlIdentity(portalUrl);
    if (normalizedPortal !== null) {
      keys.push(`icims-url:${normalizedPortal.toLowerCase()}`);
    }
  }
  return keys;
}

function selectGroupKeeper(
  database: JobDatabase,
  group: readonly TenantKeyedSource[],
  linkedSiteSourceIds: ReadonlySet<string>,
): TenantKeyedSource {
  const scored = group.map((member) => ({
    member,
    linked: linkedSiteSourceIds.has(member.row.id),
    jobs: countLinkedJobs(database, member.row.id),
  }));
  scored.sort((a, b) => {
    if (a.linked !== b.linked) return a.linked ? -1 : 1;
    if (a.jobs !== b.jobs) return b.jobs - a.jobs;
    return a.member.row.id.localeCompare(b.member.row.id);
  });
  const keeper = scored[0];
  if (keeper === undefined) {
    throw new Error('Cannot select a keeper from an empty duplicate group');
  }
  return keeper.member;
}

function recommendationForProvider(providerId: string): string {
  switch (providerId) {
    case 'usajobs':
      return 'Remains enabled per user direction. Zero jobs discovered is not evidence that the source is unsupported or broken; configure USAJOBS credentials in the desktop Settings, then re-evaluate yield. This CLI must never disable it automatically.';
    case 'wellfound':
    case 'ziprecruiter':
      return 'Remains enabled per user direction. Browser-session failures are expected and require manual login or security-check intervention. Preserve its browser-session configuration; report health issues without disabling.';
    case 'linkedin':
    case 'indeed':
    case 'handshake':
      return 'Browser-session connector: failures usually require manual login or user interaction. Report-only; automatic disabling is not permitted for browser-session providers.';
    case 'dice':
      return 'Browser-session connector subject to its published terms and robots policy. Report-only; automatic disabling is not permitted for browser-session providers.';
    default:
      return 'Protected provider: report-only; automatic disabling is not permitted.';
  }
}

function truncateReason(reason: string): string {
  return reason.length > MAX_HEALTH_MESSAGE_LENGTH
    ? `${reason.slice(0, MAX_HEALTH_MESSAGE_LENGTH - 1)}…`
    : reason;
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

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const live = arguments_.includes('--live');
  const mode = live ? 'LIVE (writes enabled)' : 'DRY-RUN (no changes)';
  const databasePath =
    process.env['JOB_BROWSER_DB_PATH'] ?? defaultDatabasePath();
  const database = openDatabase(databasePath);
  try {
    assertRequiredSchema(database);
    const plan = planRemediation(database);

    console.log(`=== SOURCE REMEDIATION (${mode}) ===`);
    console.log(`Database: ${databasePath}`);
    console.log(`Planned disable actions: ${String(plan.actions.length)}`);
    for (const action of plan.actions) {
      console.log(
        `  - [${action.rules.join(', ')}] ${action.employer} (${action.providerId}) ${action.sourceId}`,
      );
      console.log(`      ${action.reason}`);
    }
    console.log(`Report-only entries: ${String(plan.reportOnly.length)}`);
    for (const item of plan.reportOnly) {
      console.log(`  - (${item.kind}) ${item.subject}`);
      console.log(`      ${item.detail}`);
      console.log(`      -> ${item.recommendation}`);
    }

    if (!live) {
      console.log('DRY-RUN complete. No records were modified.');
      return;
    }
    if (plan.actions.length === 0) {
      console.log('Nothing to apply.');
      return;
    }

    const backupPath = await createVerifiedBackup(database, databasePath);
    console.log(`Verified pre-change backup: ${backupPath}`);

    const result = applyRemediationActions(database, plan.actions);
    console.log(
      `Applied ${String(result.applied.length)} disable action(s), skipped ${String(result.alreadyDisabled.length)} already-disabled source(s).`,
    );
    for (const applied of result.applied) {
      console.log(`  disabled: ${applied.sourceId}`);
    }
    console.log('Live remediation complete. No records were deleted.');
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
