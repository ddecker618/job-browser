import { randomUUID } from 'node:crypto';

import type { JobDatabase } from '../db/database.js';
import {
  COMPANY_RESOLVER_VERSION,
  type CompanyBucket,
  type CompanyResolution,
} from '../models/company.js';
import { nowUtc } from '../utilities/timestamps.js';

const GENERIC_COMPANY_KEYS = new Set([
  '',
  'unknown',
  'unknown company',
  'n/a',
  'na',
  'not specified',
  'confidential',
  'confidential company',
  'company confidential',
  'undisclosed',
  'various',
  'multiple companies',
]);

export function normalizeCompanyExactV1(companyText: string): string | null {
  const key = companyText
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
  return GENERIC_COMPANY_KEYS.has(key) ? null : key;
}

export class CompanyRepository {
  public constructor(private readonly database: JobDatabase) {}

  public assignJob(
    jobId: string,
    companyText: string,
    method = 'ingestion-exact',
    assignedAt = nowUtc(),
  ): CompanyResolution {
    const resolution = this.resolve(companyText, assignedAt);
    this.database
      .prepare('UPDATE jobs SET company_id = ? WHERE id = ?')
      .run(resolution.companyId, jobId);
    this.database
      .prepare(
        `INSERT INTO job_company_assignments (
          id, job_id, company_id, original_company_text, normalized_key, result,
          resolver_method, resolver_version, assigned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        jobId,
        resolution.companyId,
        companyText,
        resolution.normalizedKey,
        resolution.result,
        method,
        COMPANY_RESOLVER_VERSION,
        assignedAt,
      );
    return resolution;
  }

  public assignApplication(
    applicationId: string,
    companyText: string | null,
    method = 'application-exact',
    assignedAt = nowUtc(),
  ): CompanyResolution {
    const resolution =
      companyText === null
        ? {
            companyId: null,
            normalizedKey: null,
            result: 'ineligible' as const,
          }
        : this.resolve(companyText, assignedAt);
    this.database
      .prepare('UPDATE applications SET company_id = ? WHERE id = ?')
      .run(resolution.companyId, applicationId);
    this.database
      .prepare(
        `INSERT INTO application_company_assignments (
          id, application_id, company_id, original_company_text, normalized_key,
          result, resolver_method, resolver_version, assigned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        applicationId,
        resolution.companyId,
        companyText,
        resolution.normalizedKey,
        resolution.result,
        method,
        COMPANY_RESOLVER_VERSION,
        assignedAt,
      );
    return resolution;
  }

  public listApplicationBuckets(): CompanyBucket[] {
    return this.database
      .prepare<
        [],
        {
          company_id: string | null;
          canonical_name: string | null;
          count: number;
        }
      >(
        `SELECT applications.company_id, companies.canonical_name,
                COUNT(*) AS count
           FROM applications
           LEFT JOIN companies ON companies.id = applications.company_id
          GROUP BY applications.company_id, companies.canonical_name
          ORDER BY applications.company_id IS NULL DESC, companies.canonical_name`,
      )
      .all()
      .map((row) => ({
        companyId: row.company_id,
        canonicalName: row.canonical_name ?? 'Unknown / Unlinked',
        applicationCount: row.count,
      }));
  }

  private resolve(companyText: string, timestamp: string): CompanyResolution {
    const normalizedKey = normalizeCompanyExactV1(companyText);
    if (normalizedKey === null) {
      return { companyId: null, normalizedKey: null, result: 'ineligible' };
    }
    const matches = this.database
      .prepare<
        [string],
        { id: string }
      >('SELECT id FROM companies WHERE normalized_key = ? ORDER BY id')
      .all(normalizedKey);
    if (matches.length > 1) {
      return { companyId: null, normalizedKey, result: 'conflict' };
    }
    if (matches[0] !== undefined) {
      return { companyId: matches[0].id, normalizedKey, result: 'resolved' };
    }
    const companyId = randomUUID();
    this.database
      .prepare(
        `INSERT INTO companies (
          id, canonical_name, normalized_key, resolver_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        companyId,
        companyText.trim(),
        normalizedKey,
        COMPANY_RESOLVER_VERSION,
        timestamp,
        timestamp,
      );
    return { companyId, normalizedKey, result: 'resolved' };
  }
}
