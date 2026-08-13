import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import { nowUtc } from '../utilities/timestamps.js';
import { fingerprintCareerSiteUrl } from '../domain/atsFingerprint.js';
import type {
  CareerSite,
  CareerSiteDiscoveryState,
  CareerSiteHealthStatus,
  CareerSiteVerificationHistory,
  CareerSiteEvidence,
  CareerSiteFingerprint,
  CareerSiteSummary,
  Employer,
  EmployerWithSites,
  EmployerSeed,
  EmployerSeedImportResult,
  VerificationState,
} from '../models/employer.js';

interface EmployerRow {
  id: string;
  name: string;
  normalized_name: string;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

interface CareerSiteRow {
  id: string;
  employer_id: string;
  employer_name: string;
  url: string;
  normalized_url: string;
  ats_platform: string | null;
  ats_detected_provider: string | null;
  ats_confidence: number | null;
  ats_support_state: string | null;
  fingerprint_evidence_json: string | null;
  fingerprint_confidence_label: string | null;
  fingerprint_version: string | null;
  fingerprint_observed_at: string | null;
  verification_state: VerificationState;
  last_verified_at: string | null;
  source_id: string | null;
  discovery_state: CareerSiteDiscoveryState;
  discovery_attempt_count: number;
  last_discovery_attempt_at: string | null;
  last_discovery_result: string | null;
  next_discovery_attempt_at: string | null;
  discovery_provenance: string;
  health_status: CareerSiteHealthStatus;
  health_checked_at: string | null;
  health_message: string | null;
  health_failure_count: number;
  health_effective_url: string | null;
  health_next_check_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EvidenceRow {
  id: string;
  career_site_id: string;
  kind: string;
  detail: string;
  confidence: number;
  observed_at: string;
  created_at: string;
}

interface VerificationHistoryRow {
  id: string;
  career_site_id: string;
  requested_url: string;
  effective_url: string | null;
  http_status: number | null;
  result_classification: string;
  previous_ats_provider: string | null;
  detected_ats_platform: string | null;
  detected_provider: string | null;
  confidence: number;
  evidence_json: string;
  previous_health_status: CareerSiteHealthStatus;
  resulting_health_status: CareerSiteHealthStatus;
  reason: string;
  observed_at: string;
}

export interface EmployerInput {
  name: string;
  websiteUrl: string | null;
}

export interface CareerSiteInput {
  url: string;
}

export class EmployerRepository {
  public constructor(private readonly database: JobDatabase) {}

  public listEmployers(): Employer[] {
    return this.database
      .prepare<[], EmployerRow>('SELECT * FROM employers ORDER BY name ASC')
      .all()
      .map(mapEmployer);
  }

  public getEmployer(id: string): Employer | null {
    const row = this.database
      .prepare<[string], EmployerRow>('SELECT * FROM employers WHERE id = ?')
      .get(id);
    return row === undefined ? null : mapEmployer(row);
  }

  public createEmployer(input: EmployerInput): Employer {
    const id = randomUUID();
    const timestamp = nowUtc();
    const normalizedName = input.name.trim().toLowerCase();
    this.database
      .prepare(
        `INSERT INTO employers (id, name, normalized_name, website_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        normalizedName,
        input.websiteUrl,
        timestamp,
        timestamp,
      );
    return this.getEmployer(id) ?? buildEmployerFromInput(id, input, timestamp);
  }

  public listCareerSites(employerId: string): CareerSite[] {
    return this.database
      .prepare<[string], Omit<CareerSiteRow, 'employer_name'>>(
        'SELECT * FROM career_sites WHERE employer_id = ? ORDER BY url ASC',
      )
      .all(employerId)
      .map((row) => mapCareerSite(row));
  }

  public getCareerSite(id: string): CareerSite | null {
    const row = this.database
      .prepare<[string], CareerSiteRow>(
        `SELECT cs.*, e.name AS employer_name
         FROM career_sites cs
         JOIN employers e ON e.id = cs.employer_id
         WHERE cs.id = ?`,
      )
      .get(id);
    return row === undefined ? null : mapCareerSiteWithEvidence(row);
  }

  public createCareerSite(
    employerId: string,
    input: CareerSiteInput,
  ): CareerSite {
    const employer = this.getEmployer(employerId);
    if (employer === null) {
      throw new Error(`Employer not found: ${employerId}`);
    }
    const id = randomUUID();
    const timestamp = nowUtc();
    const url = input.url.trim();
    const normalizedUrl = normalizeUrlString(url);
    this.database
      .prepare(
        `INSERT INTO career_sites (
          id, employer_id, url, normalized_url, ats_platform, ats_detected_provider,
          ats_confidence, ats_support_state, fingerprint_evidence_json,
          fingerprint_confidence_label, fingerprint_version, fingerprint_observed_at,
          verification_state, last_verified_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'unverified', NULL, ?, ?)`,
      )
      .run(id, employerId, url, normalizedUrl, timestamp, timestamp);
    const site = this.getCareerSite(id);
    if (site === null)
      throw new Error('Created career site could not be loaded');
    return site;
  }

  public verifyCareerSite(id: string): CareerSite {
    this.computeAndStoreFingerprint(id);
    const site = this.getCareerSite(id);
    if (site === null) throw new Error(`Career site not found: ${id}`);
    return site;
  }

  public listDiscoveryEligible(
    atTimestamp = nowUtc(),
    limit = 25,
  ): CareerSite[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new RangeError('Employer discovery limit must be between 1 and 25');
    }
    return this.database
      .prepare<[string, number], CareerSiteRow>(
        `SELECT cs.*, e.name AS employer_name
           FROM career_sites cs
           JOIN employers e ON e.id = cs.employer_id
          WHERE cs.discovery_state IN ('ready', 'failed', 'backoff')
            AND (cs.next_discovery_attempt_at IS NULL OR cs.next_discovery_attempt_at <= ?)
          ORDER BY cs.created_at, cs.id LIMIT ?`,
      )
      .all(atTimestamp, limit)
      .map(mapCareerSiteWithEvidence);
  }

  public importSeeds(seeds: readonly EmployerSeed[]): EmployerSeedImportResult {
    const bounded = seeds.slice(0, 25);
    const result: EmployerSeedImportResult = {
      considered: bounded.length,
      employersCreated: 0,
      employersReused: 0,
      careerSitesCreated: 0,
      careerSitesReused: 0,
      rejected: 0,
      truncated: seeds.length > bounded.length,
    };
    this.database.transaction(() => {
      for (const seed of bounded) {
        const name = seed.name.trim();
        const normalizedName = name
          .toLocaleLowerCase('en-US')
          .replace(/\s+/g, ' ');
        const urls = [...new Set(seed.careerSiteUrls.slice(0, 5))];
        const normalizedUrls = urls.map(validatedUrl);
        if (
          name.length === 0 ||
          seed.provenance.trim().length === 0 ||
          normalizedUrls.some((url) => url === null)
        ) {
          result.rejected += 1;
          continue;
        }
        let employer = this.database
          .prepare<
            [string],
            EmployerRow
          >('SELECT * FROM employers WHERE normalized_name = ?')
          .get(normalizedName);
        if (employer === undefined) {
          const created = this.createEmployer({
            name,
            websiteUrl: seed.websiteUrl,
          });
          employer = {
            id: created.id,
            name: created.name,
            normalized_name: created.normalizedName,
            website_url: created.websiteUrl,
            created_at: created.createdAt,
            updated_at: created.updatedAt,
          };
          result.employersCreated += 1;
        } else {
          result.employersReused += 1;
        }
        for (let index = 0; index < urls.length; index += 1) {
          const normalizedUrl = normalizedUrls[index];
          const sourceUrl = urls[index];
          if (
            normalizedUrl === null ||
            normalizedUrl === undefined ||
            sourceUrl === undefined
          ) {
            continue;
          }
          const existing = this.database
            .prepare<
              [string, string],
              { id: string }
            >('SELECT id FROM career_sites WHERE employer_id = ? AND normalized_url = ?')
            .get(employer.id, normalizedUrl);
          if (existing !== undefined) {
            result.careerSitesReused += 1;
            continue;
          }
          const site = this.createCareerSite(employer.id, {
            url: sourceUrl,
          });
          this.database
            .prepare(
              'UPDATE career_sites SET discovery_provenance = ? WHERE id = ?',
            )
            .run(seed.provenance.trim(), site.id);
          result.careerSitesCreated += 1;
        }
      }
    })();
    return result;
  }

  public recordDiscoveryAttempt(input: {
    careerSiteId: string;
    state: CareerSiteDiscoveryState;
    result:
      | 'success'
      | 'source-created'
      | 'source-reused'
      | 'unsupported'
      | 'failed'
      | 'skipped';
    providerId: string | null;
    sourceId: string | null;
    detail: string;
    attemptedAt: string;
    nextEligibleAt: string | null;
  }): CareerSite {
    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE career_sites SET source_id = ?, discovery_state = ?,
             discovery_attempt_count = discovery_attempt_count + 1,
             last_discovery_attempt_at = ?, last_discovery_result = ?,
             next_discovery_attempt_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.sourceId,
          input.state,
          input.attemptedAt,
          input.detail,
          input.nextEligibleAt,
          input.attemptedAt,
          input.careerSiteId,
        );
      this.database
        .prepare(
          `INSERT INTO career_site_discovery_attempts (
             id, career_site_id, provenance, result, provider_id, source_id,
             detail, attempted_at, next_eligible_at
           ) SELECT ?, id, discovery_provenance, ?, ?, ?, ?, ?, ?
               FROM career_sites WHERE id = ?`,
        )
        .run(
          randomUUID(),
          input.result,
          input.providerId,
          input.sourceId,
          input.detail,
          input.attemptedAt,
          input.nextEligibleAt,
          input.careerSiteId,
        );
    })();
    const site = this.getCareerSite(input.careerSiteId);
    if (site === null)
      throw new Error(`Career site not found: ${input.careerSiteId}`);
    return site;
  }

  public listHealthEligible(atTimestamp = nowUtc(), limit = 25): CareerSite[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
      throw new RangeError('CareerSite health limit must be between 1 and 25');
    }
    return this.database
      .prepare<[string, number], CareerSiteRow>(
        `SELECT cs.*, e.name AS employer_name
           FROM career_sites cs
           JOIN employers e ON e.id = cs.employer_id
          WHERE cs.health_status != 'retired'
            AND (cs.health_next_check_at IS NULL OR cs.health_next_check_at <= ?)
          ORDER BY COALESCE(cs.health_checked_at, ''), cs.id
          LIMIT ?`,
      )
      .all(atTimestamp, limit)
      .map(mapCareerSiteWithEvidence);
  }

  public recordHealthObservation(input: {
    careerSiteId: string;
    requestedUrl: string;
    effectiveUrl: string | null;
    httpStatus: number | null;
    resultClassification: string;
    detectedAtsPlatform: string | null;
    detectedProvider: string | null;
    supportState: string;
    confidence: number;
    evidence: readonly string[];
    resultingStatus: CareerSiteHealthStatus;
    reason: string;
    observedAt: string;
    failureCount: number;
    nextCheckAt: string | null;
  }): CareerSite {
    const current = this.getCareerSite(input.careerSiteId);
    if (current === null)
      throw new Error(`Career site not found: ${input.careerSiteId}`);
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO career_site_verification_history (
             id, career_site_id, requested_url, effective_url, http_status,
             result_classification, previous_ats_provider, detected_ats_platform,
             detected_provider, confidence, evidence_json, previous_health_status,
             resulting_health_status, reason, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.careerSiteId,
          input.requestedUrl,
          input.effectiveUrl,
          input.httpStatus,
          input.resultClassification,
          current.fingerprint?.atsDetectedProvider ?? null,
          input.detectedAtsPlatform,
          input.detectedProvider,
          input.confidence,
          JSON.stringify(input.evidence),
          current.health.status,
          input.resultingStatus,
          input.reason.slice(0, 1000),
          input.observedAt,
        );
      this.database
        .prepare(
          `UPDATE career_sites SET health_status = ?, health_checked_at = ?,
             health_message = ?, health_failure_count = ?, health_effective_url = ?,
             health_next_check_at = ?, ats_platform = ?, ats_detected_provider = ?,
             ats_confidence = ?, ats_support_state = ?, last_verified_at = ?,
             verification_state = 'verified', updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.resultingStatus,
          input.observedAt,
          input.reason.slice(0, 1000),
          input.failureCount,
          input.effectiveUrl,
          input.nextCheckAt,
          input.detectedAtsPlatform,
          input.detectedProvider,
          input.confidence,
          input.supportState,
          input.observedAt,
          input.observedAt,
          input.careerSiteId,
        );
    })();
    const updatedSite = this.getCareerSite(input.careerSiteId);
    if (updatedSite === null) {
      throw new Error(`Career site not found: ${input.careerSiteId}`);
    }
    return updatedSite;
  }

  public retireCareerSite(id: string, reason = 'Retired by user'): CareerSite {
    const timestamp = nowUtc();
    const site = this.getCareerSite(id);
    if (site === null) throw new Error(`Career site not found: ${id}`);
    this.database
      .prepare(
        `UPDATE career_sites SET health_status = 'retired', health_checked_at = ?,
           health_message = ?, health_next_check_at = NULL, discovery_state = 'retired',
           updated_at = ? WHERE id = ?`,
      )
      .run(timestamp, reason.slice(0, 1000), timestamp, id);
    const retiredSite = this.getCareerSite(id);
    if (retiredSite === null) throw new Error(`Career site not found: ${id}`);
    return retiredSite;
  }

  public listVerificationHistory(
    careerSiteId: string,
  ): CareerSiteVerificationHistory[] {
    return this.database
      .prepare<[string], VerificationHistoryRow>(
        `SELECT * FROM career_site_verification_history
          WHERE career_site_id = ? ORDER BY observed_at DESC, id DESC`,
      )
      .all(careerSiteId)
      .map((row) => ({
        id: row.id,
        careerSiteId: row.career_site_id,
        requestedUrl: row.requested_url,
        effectiveUrl: row.effective_url,
        httpStatus: row.http_status,
        resultClassification: row.result_classification,
        previousAtsProvider: row.previous_ats_provider,
        detectedAtsPlatform: row.detected_ats_platform,
        detectedProvider: row.detected_provider,
        confidence: row.confidence,
        evidence: JSON.parse(row.evidence_json) as string[],
        previousHealthStatus: row.previous_health_status,
        resultingHealthStatus: row.resulting_health_status,
        reason: row.reason,
        observedAt: row.observed_at,
      }));
  }

  public listEmployersWithSites(): EmployerWithSites[] {
    const employers = this.listEmployers();
    return employers.map((employer) => ({
      employer,
      careerSites: this.database
        .prepare<[string], CareerSiteRow>(
          `SELECT cs.*, e.name AS employer_name
           FROM career_sites cs
           JOIN employers e ON e.id = cs.employer_id
           WHERE cs.employer_id = ?
           ORDER BY cs.url ASC`,
        )
        .all(employer.id)
        .map(mapCareerSiteSummary),
    }));
  }

  public listCareerSiteEvidence(careerSiteId: string): CareerSiteEvidence[] {
    return this.database
      .prepare<[string], EvidenceRow>(
        'SELECT * FROM career_site_evidence WHERE career_site_id = ? ORDER BY observed_at DESC',
      )
      .all(careerSiteId)
      .map((row) => ({
        id: row.id,
        careerSiteId: row.career_site_id,
        kind: row.kind,
        detail: row.detail,
        confidence: row.confidence,
        observedAt: row.observed_at,
        createdAt: row.created_at,
      }));
  }

  public deleteCareerSite(id: string): void {
    this.database.prepare('DELETE FROM career_sites WHERE id = ?').run(id);
  }

  public deleteEmployer(id: string): void {
    this.database.prepare('DELETE FROM employers WHERE id = ?').run(id);
  }

  private computeAndStoreFingerprint(id: string): void {
    const siteRow = this.database
      .prepare<
        [string],
        { url: string }
      >('SELECT url FROM career_sites WHERE id = ?')
      .get(id);
    if (siteRow === undefined) {
      throw new Error(`Career site not found: ${id}`);
    }
    const fingerprint = fingerprintCareerSiteUrl(siteRow.url);
    const timestamp = nowUtc();

    this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE career_sites SET
             ats_platform = ?, ats_detected_provider = ?, ats_confidence = ?,
             ats_support_state = ?, fingerprint_evidence_json = ?,
             fingerprint_confidence_label = ?, fingerprint_version = ?,
             fingerprint_observed_at = ?, verification_state = 'verified',
             last_verified_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          fingerprint.atsPlatform,
          fingerprint.atsDetectedProvider,
          fingerprint.confidence,
          fingerprint.supportState,
          JSON.stringify(fingerprint.evidence),
          fingerprint.confidenceLabel,
          fingerprint.detectionVersion,
          fingerprint.observedAt,
          timestamp,
          timestamp,
          id,
        );

      this.database
        .prepare('DELETE FROM career_site_evidence WHERE career_site_id = ?')
        .run(id);

      const updateEvidence = this.database.prepare(
        `INSERT INTO career_site_evidence (
          id, career_site_id, kind, detail, confidence, observed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const evidence of fingerprint.evidence) {
        updateEvidence.run(
          randomUUID(),
          id,
          evidence.kind,
          evidence.detail,
          evidence.confidence,
          evidence.observedAt,
          timestamp,
        );
      }
    })();
  }
}

function mapEmployer(row: EmployerRow): Employer {
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    websiteUrl: row.website_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCareerSite(row: Omit<CareerSiteRow, 'employer_name'>): CareerSite {
  const fingerprint = parseFingerprintFromRow(row);
  return {
    id: row.id,
    employerId: row.employer_id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    fingerprint,
    verificationState: row.verification_state,
    lastVerifiedAt: row.last_verified_at,
    discovery: mapDiscovery(row),
    health: mapHealth(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCareerSiteWithEvidence(row: CareerSiteRow): CareerSite {
  const fingerprint = parseFingerprintFromRow(row);
  return {
    id: row.id,
    employerId: row.employer_id,
    url: row.url,
    normalizedUrl: row.normalized_url,
    fingerprint,
    verificationState: row.verification_state,
    lastVerifiedAt: row.last_verified_at,
    discovery: mapDiscovery(row),
    health: mapHealth(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCareerSiteSummary(row: CareerSiteRow): CareerSiteSummary {
  const fingerprint = parseFingerprintFromRow(row);
  const evidenceCount = fingerprint ? fingerprint.evidence.length : 0;
  return {
    id: row.id,
    employerId: row.employer_id,
    employerName: row.employer_name,
    url: row.url,
    atsPlatform: row.ats_platform,
    atsDetectedProvider: row.ats_detected_provider,
    confidence: row.ats_confidence ?? 0,
    confidenceLabel:
      row.fingerprint_confidence_label === 'high' ||
      row.fingerprint_confidence_label === 'medium' ||
      row.fingerprint_confidence_label === 'low'
        ? row.fingerprint_confidence_label
        : 'low',
    supportState:
      row.ats_support_state === 'supported' ||
      row.ats_support_state === 'supported-with-configuration' ||
      row.ats_support_state === 'detected-but-unsupported' ||
      row.ats_support_state === 'structured-data-fallback-available' ||
      row.ats_support_state === 'unsupported'
        ? row.ats_support_state
        : 'unsupported',
    verificationState: row.verification_state,
    lastVerifiedAt: row.last_verified_at,
    discovery: mapDiscovery(row),
    health: mapHealth(row),
    explanation: fingerprint ? fingerprint.explanation : null,
    evidenceCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDiscovery(
  row: Pick<
    CareerSiteRow,
    | 'source_id'
    | 'discovery_state'
    | 'discovery_attempt_count'
    | 'last_discovery_attempt_at'
    | 'last_discovery_result'
    | 'next_discovery_attempt_at'
    | 'discovery_provenance'
  >,
): CareerSite['discovery'] {
  return {
    sourceId: row.source_id,
    state: row.discovery_state,
    attemptCount: row.discovery_attempt_count,
    lastAttemptAt: row.last_discovery_attempt_at,
    lastResult: row.last_discovery_result,
    nextAttemptAt: row.next_discovery_attempt_at,
    provenance: row.discovery_provenance,
  };
}

function mapHealth(
  row: Pick<
    CareerSiteRow,
    | 'health_status'
    | 'health_checked_at'
    | 'health_message'
    | 'health_failure_count'
    | 'health_effective_url'
    | 'health_next_check_at'
  >,
): CareerSite['health'] {
  return {
    status: row.health_status,
    checkedAt: row.health_checked_at,
    message: row.health_message,
    failureCount: row.health_failure_count,
    effectiveUrl: row.health_effective_url,
    nextCheckAt: row.health_next_check_at,
  };
}

function parseFingerprintFromRow(row: {
  fingerprint_evidence_json: string | null;
  fingerprint_confidence_label: string | null;
  fingerprint_version: string | null;
  fingerprint_observed_at: string | null;
  ats_platform: string | null;
  ats_detected_provider: string | null;
  ats_confidence: number | null;
  ats_support_state: string | null;
}): CareerSiteFingerprint | null {
  if (
    row.ats_platform === null &&
    row.ats_detected_provider === null &&
    row.ats_confidence === null &&
    row.fingerprint_evidence_json === null
  ) {
    return null;
  }
  let evidence: CareerSiteEvidence[] = [];
  if (row.fingerprint_evidence_json !== null) {
    const parsed = JSON.parse(row.fingerprint_evidence_json) as unknown;
    if (Array.isArray(parsed)) {
      evidence = parsed
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null,
        )
        .map((item) => ({
          id: '',
          careerSiteId: '',
          kind: typeof item['kind'] === 'string' ? item['kind'] : '',
          detail: typeof item['detail'] === 'string' ? item['detail'] : '',
          confidence:
            typeof item['confidence'] === 'number' ? item['confidence'] : 0,
          observedAt:
            typeof item['observedAt'] === 'string' ? item['observedAt'] : '',
          createdAt: '',
        }));
    }
  }
  return {
    atsPlatform: row.ats_platform,
    atsDetectedProvider: row.ats_detected_provider,
    confidence: row.ats_confidence ?? 0,
    confidenceLabel:
      row.fingerprint_confidence_label === 'high' ||
      row.fingerprint_confidence_label === 'medium' ||
      row.fingerprint_confidence_label === 'low'
        ? row.fingerprint_confidence_label
        : 'low',
    supportState:
      row.ats_support_state === 'supported' ||
      row.ats_support_state === 'supported-with-configuration' ||
      row.ats_support_state === 'detected-but-unsupported' ||
      row.ats_support_state === 'structured-data-fallback-available' ||
      row.ats_support_state === 'unsupported'
        ? row.ats_support_state
        : 'unsupported',
    evidence,
    detectedVariant: null,
    listingsUrl: null,
    sitemapUrl: null,
    portalOrigin: null,
    explanation: '',
    detectionVersion: row.fingerprint_version ?? '',
    observedAt: row.fingerprint_observed_at ?? '',
    structuredFallback: false,
    failureCategory: null,
  };
}

function normalizeUrlString(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.toString();
  } catch {
    return url.toLowerCase();
  }
}

function validatedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function buildEmployerFromInput(
  id: string,
  input: EmployerInput,
  timestamp: string,
): Employer {
  return {
    id,
    name: input.name.trim(),
    normalizedName: input.name.trim().toLowerCase(),
    websiteUrl: input.websiteUrl,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
