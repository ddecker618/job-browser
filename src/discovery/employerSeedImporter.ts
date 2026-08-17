import type { JobDatabase } from '../db/database.js';
import { detectCareerSiteProvider } from '../domain/atsFingerprint.js';
import {
  atsTenantIdentity,
  canonicalConfigJson,
  normalizeDomainIdentity,
  normalizeEmployerName,
  normalizeUrlIdentity,
} from '../domain/urlIdentity.js';
import type {
  EmployerManifestImportResult,
  EmployerManifestImportRowResult,
  EmployerManifestRowStatus,
} from '../models/employer-manifest.js';
import type { CareerSite } from '../models/employer.js';
import type {
  ConfiguredSource,
  ProviderConfiguration,
  SourceInput,
} from '../models/source-management.js';
import { EmployerRepository } from '../repositories/employerRepository.js';
import { SourceRepository } from '../repositories/source-repository.js';
import type {
  EmployerManifestParseResult,
  ParsedEmployerManifestRow,
} from '../schemas/employer-manifest.js';

const MAX_BATCH_SIZE = 25;
const UNSUPPORTED_DETAIL =
  'No supported ATS identified by URL fingerprint; no Source created';

interface ResolvedEmployer {
  key: string;
  id: string | null;
  name: string;
  normalizedName: string;
  websiteUrl: string | null;
}

interface ResolvedSite {
  key: string;
  id: string | null;
  employerKey: string;
  url: string;
  normalizedUrl: string;
  identity: string;
  providerId: string | null;
  atsIdentity: string | null;
  effectiveUrl: string | null;
  effectiveUrlIdentity: string | null;
  retired: boolean;
  discoveryState: string;
  sourceId: string | null;
  provenance: string;
}

interface ResolvedSource {
  id: string | null;
  employer: string;
  providerId: string | null;
  careersUrl: string | null;
  configuration: ProviderConfiguration;
  configurationStatus: string;
  enabled: boolean;
  archivedAt: string | null;
  healthStatus: string;
  configJson: string;
  atsIdentity: string | null;
}

type EmployerResolution =
  | { kind: 'resolved'; employer: ResolvedEmployer; created: boolean }
  | { kind: 'ambiguous' }
  | { kind: 'invalid-domain' };

type SiteResolution =
  | { kind: 'site'; site: ResolvedSite }
  | { kind: 'none' }
  | { kind: 'ambiguous' };

interface PendingCounters {
  invalid: number;
  inBatchDuplicates: number;
  employersCreated: number;
  employersReused: number;
  careerSitesCreated: number;
  careerSitesReused: number;
  sourcesCreated: number;
  sourcesReused: number;
  aliasesAdded: number;
  evidenceAdded: number;
  unsupportedCandidates: number;
  ambiguousConflicts: number;
  skipped: number;
  enabled: number;
  leftDisabled: number;
}

export interface EmployerImportOptions {
  dryRun?: boolean;
}

export class EmployerSeedImporter {
  private dryRun = false;
  private observedAt = '';
  private result: EmployerManifestImportResult | null = null;
  private pending: PendingCounters = zeroPendingCounters();
  private pendingRows: EmployerManifestImportRowResult[] = [];

  private employersById = new Map<string, ResolvedEmployer>();
  private employersByName = new Map<string, ResolvedEmployer>();
  private employersByDomain = new Map<string, ResolvedEmployer[]>();
  private aliasToEmployer = new Map<string, ResolvedEmployer>();
  private sitesByEmployer = new Map<string, Map<string, ResolvedSite>>();
  private sitesByUrl = new Map<string, ResolvedSite[]>();
  private evidenceByEmployer = new Map<string, Map<string, Set<string>>>();
  private allSources: ResolvedSource[] = [];
  private sourcesById = new Map<string, ResolvedSource>();
  private seenUrlIdentities = new Set<string>();
  private currentBatchSeen = new Set<string>();

  public constructor(
    private readonly database: JobDatabase,
    private readonly employers: EmployerRepository,
    private readonly sources: SourceRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly batchSize = MAX_BATCH_SIZE,
  ) {
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_BATCH_SIZE
    ) {
      throw new RangeError(
        `Manifest import batch size must be between 1 and ${String(MAX_BATCH_SIZE)}`,
      );
    }
  }

  public importManifest(
    parsed: EmployerManifestParseResult,
    options: EmployerImportOptions = {},
  ): EmployerManifestImportResult {
    this.reset(parsed.version, options.dryRun ?? false);
    const result = this.result;
    if (result === null) throw new Error('Importer is not initialized');
    result.inputRows = parsed.rows.length + parsed.invalidRows.length;
    for (const invalid of parsed.invalidRows) {
      result.invalid += 1;
      result.rows.push({
        index: invalid.index,
        status: 'rejected',
        employerName: null,
        careersUrl: null,
        employerId: null,
        careerSiteId: null,
        sourceId: null,
        reason: invalid.reason,
      });
    }
    const validRows = parsed.rows;
    for (let start = 0; start < validRows.length; start += this.batchSize) {
      const chunk = validRows.slice(start, start + this.batchSize);
      result.batches += 1;
      const batchNumber = result.batches;
      this.pending = zeroPendingCounters();
      this.pendingRows = [];
      this.currentBatchSeen = new Set<string>();
      try {
        if (this.dryRun) {
          for (const parsedRow of chunk) this.processRow(parsedRow);
        } else {
          this.database.transaction(() => {
            for (const parsedRow of chunk) this.processRow(parsedRow);
          })();
        }
        this.commitPending();
      } catch (error) {
        this.rollbackPending(chunk, batchNumber, error);
      }
    }
    return result;
  }

  private reset(version: string, dryRun: boolean): void {
    this.dryRun = dryRun;
    this.observedAt = this.now().toISOString();
    this.result = emptyResult(version, dryRun);
    this.pending = zeroPendingCounters();
    this.pendingRows = [];
    this.seenUrlIdentities = new Set<string>();
    this.currentBatchSeen = new Set<string>();
    this.employersById = new Map<string, ResolvedEmployer>();
    this.employersByName = new Map<string, ResolvedEmployer>();
    this.employersByDomain = new Map<string, ResolvedEmployer[]>();
    this.aliasToEmployer = new Map<string, ResolvedEmployer>();
    this.sitesByEmployer = new Map<string, Map<string, ResolvedSite>>();
    this.sitesByUrl = new Map<string, ResolvedSite[]>();
    this.evidenceByEmployer = new Map<string, Map<string, Set<string>>>();
    this.allSources = [];
    this.sourcesById = new Map<string, ResolvedSource>();
    this.rebuildIndexesFromDatabase();
  }

  private rebuildIndexesFromDatabase(): void {
    this.employersById = new Map<string, ResolvedEmployer>();
    this.employersByName = new Map<string, ResolvedEmployer>();
    this.employersByDomain = new Map<string, ResolvedEmployer[]>();
    this.aliasToEmployer = new Map<string, ResolvedEmployer>();
    for (const employer of this.employers.listEmployers()) {
      const resolved: ResolvedEmployer = {
        key: employer.id,
        id: employer.id,
        name: employer.name,
        normalizedName: employer.normalizedName,
        websiteUrl: employer.websiteUrl,
      };
      this.employersById.set(employer.id, resolved);
      this.employersByName.set(employer.normalizedName, resolved);
      if (employer.websiteUrl !== null) {
        const domain = normalizeDomainIdentity(employer.websiteUrl);
        if (domain !== null)
          pushEmployer(this.employersByDomain, domain, resolved);
      }
    }
    for (const alias of this.employers.listAliases()) {
      const employer = this.employersById.get(alias.employerId);
      if (employer !== undefined) {
        this.aliasToEmployer.set(alias.normalizedAlias, employer);
      }
    }
    this.sitesByEmployer = new Map<string, Map<string, ResolvedSite>>();
    this.sitesByUrl = new Map<string, ResolvedSite[]>();
    for (const site of this.employers.listAllCareerSites()) {
      this.indexSite(wrapSite(site));
    }
    this.evidenceByEmployer = new Map<string, Map<string, Set<string>>>();
    for (const evidence of this.employers.listAllEvidence()) {
      const employer = this.employersById.get(evidence.employerId);
      if (employer === undefined) continue;
      let bySite = this.evidenceByEmployer.get(employer.key);
      if (bySite === undefined) {
        bySite = new Map<string, Set<string>>();
        this.evidenceByEmployer.set(employer.key, bySite);
      }
      let details = bySite.get(evidence.careerSiteId);
      if (details === undefined) {
        details = new Set<string>();
        bySite.set(evidence.careerSiteId, details);
      }
      details.add(evidence.detail);
    }
    this.allSources = [];
    this.sourcesById = new Map<string, ResolvedSource>();
    for (const source of this.sources.list()) {
      this.indexSource(wrapSource(source));
    }
  }

  private processRow(parsedRow: ParsedEmployerManifestRow): void {
    const row = parsedRow.row;
    const index = parsedRow.index;
    const push = (
      status: EmployerManifestRowStatus,
      extra: {
        employerId?: string | null;
        careerSiteId?: string | null;
        sourceId?: string | null;
        reason?: string | null;
      } = {},
    ): void => {
      this.pendingRows.push({
        index,
        status,
        employerName: row.employerName ?? null,
        careersUrl: row.careersUrl ?? null,
        employerId: extra.employerId ?? null,
        careerSiteId: extra.careerSiteId ?? null,
        sourceId: extra.sourceId ?? null,
        reason: extra.reason ?? null,
      });
    };

    let storedUrl: string | null = null;
    let urlIdentity: string | null = null;
    let careersUrl: string | null = null;
    if (row.careersUrl !== undefined) {
      careersUrl = coerceCareersUrl(row.careersUrl);
      storedUrl = storedNormalizedUrl(careersUrl);
      if (storedUrl === null) {
        this.pending.invalid += 1;
        push('rejected', {
          reason: 'careersUrl is not a valid HTTP(S) URL',
        });
        return;
      }
      urlIdentity = normalizeUrlIdentity(careersUrl) ?? storedUrl;
      if (this.seenUrlIdentities.has(urlIdentity)) {
        this.pending.inBatchDuplicates += 1;
        push('in-batch-duplicate', {
          reason: 'Duplicate careersUrl within this manifest',
        });
        return;
      }
      this.seenUrlIdentities.add(urlIdentity);
      this.currentBatchSeen.add(urlIdentity);
    }

    const resolution = this.resolveEmployer(row);
    if (resolution.kind === 'invalid-domain') {
      this.pending.invalid += 1;
      push('rejected', {
        reason: `rootDomain is not a valid domain: ${row.rootDomain ?? ''}`,
      });
      return;
    }
    if (resolution.kind === 'ambiguous') {
      this.pending.ambiguousConflicts += 1;
      push('ambiguous', {
        reason: 'Employer identity is ambiguous; no rows were changed',
      });
      return;
    }
    const employer = resolution.employer;
    if (resolution.created) {
      this.pending.employersCreated += 1;
    } else {
      this.pending.employersReused += 1;
    }
    if (row.employerName !== undefined) {
      const aliasStatus = this.addAlias(
        employer,
        row.employerName,
        row.provenance,
      );
      if (aliasStatus === 'added') this.pending.aliasesAdded += 1;
    }

    if (storedUrl === null || urlIdentity === null) {
      push('employer-only', { employerId: employer.id });
      return;
    }

    const signal = detectCareerSiteProvider(careersUrl ?? storedUrl);
    if (!signal?.configuration) {
      this.processUnsupported(
        employer,
        careersUrl,
        storedUrl,
        urlIdentity,
        row,
        push,
      );
      return;
    }
    this.processSupported(
      employer,
      careersUrl,
      storedUrl,
      urlIdentity,
      signal.providerId,
      signal.configuration,
      signal.platform,
      row,
      push,
    );
  }

  private processUnsupported(
    employer: ResolvedEmployer,
    careersUrl: string | null,
    storedUrl: string,
    urlIdentity: string,
    row: ParsedEmployerManifestRow['row'],
    push: (
      status: EmployerManifestRowStatus,
      extra?: {
        employerId?: string | null;
        careerSiteId?: string | null;
        sourceId?: string | null;
        reason?: string | null;
      },
    ) => void,
  ): void {
    const siteResolution = this.resolveSite(
      employer,
      storedUrl,
      urlIdentity,
      null,
    );
    if (siteResolution.kind === 'ambiguous') {
      this.pending.ambiguousConflicts += 1;
      push('ambiguous', {
        employerId: employer.id,
        reason: 'careersUrl is already claimed by another employer',
      });
      return;
    }
    let site = siteResolution.kind === 'site' ? siteResolution.site : null;
    if (site === null) {
      site = this.createSite(employer, careersUrl ?? storedUrl, storedUrl, row);
      this.pending.careerSitesCreated += 1;
    } else {
      this.pending.careerSitesReused += 1;
    }
    if (site.retired) {
      this.pending.skipped += 1;
      push('unsupported', {
        employerId: employer.id,
        careerSiteId: site.id,
        reason: 'Retired career site reused and left as-is; no Source created',
      });
      return;
    }
    this.verifyIfNeeded(site);
    this.addImporterEvidence(site, row);
    this.recordUnsupported(site);
    this.pending.unsupportedCandidates += 1;
    push('unsupported', {
      employerId: employer.id,
      careerSiteId: site.id,
      reason: UNSUPPORTED_DETAIL,
    });
  }

  private processSupported(
    employer: ResolvedEmployer,
    careersUrl: string | null,
    storedUrl: string,
    urlIdentity: string,
    providerId: string,
    configuration: ProviderConfiguration,
    platform: string,
    row: ParsedEmployerManifestRow['row'],
    push: (
      status: EmployerManifestRowStatus,
      extra?: {
        employerId?: string | null;
        careerSiteId?: string | null;
        sourceId?: string | null;
        reason?: string | null;
      },
    ) => void,
  ): void {
    const siteResolution = this.resolveSite(employer, storedUrl, urlIdentity, {
      providerId,
      configuration,
    });
    if (siteResolution.kind === 'ambiguous') {
      this.pending.ambiguousConflicts += 1;
      push('ambiguous', {
        employerId: employer.id,
        reason:
          'careersUrl or ATS board is already claimed by another employer',
      });
      return;
    }
    let site = siteResolution.kind === 'site' ? siteResolution.site : null;
    if (site === null) {
      site = this.createSite(employer, careersUrl ?? storedUrl, storedUrl, row);
      this.pending.careerSitesCreated += 1;
    } else {
      this.pending.careerSitesReused += 1;
    }
    if (site.retired) {
      this.pending.skipped += 1;
      push('reused', {
        employerId: employer.id,
        careerSiteId: site.id,
        reason: 'Retired career site reused and left as-is; no Source created',
      });
      return;
    }
    this.verifyIfNeeded(site);
    this.addImporterEvidence(site, row);
    const sourceResolution = this.resolveSource(
      site,
      providerId,
      configuration,
      platform,
      employer.name,
      row.enabled,
    );
    const source = sourceResolution.source;
    if (sourceResolution.created) {
      this.pending.sourcesCreated += 1;
      if (source.enabled) this.pending.enabled += 1;
    } else {
      this.pending.sourcesReused += 1;
      if (source.enabled) {
        this.pending.enabled += 1;
      } else {
        this.pending.leftDisabled += 1;
        if (source.archivedAt !== null) this.pending.skipped += 1;
      }
    }
    this.recordDiscovery(
      site,
      providerId,
      sourceResolution.created ? 'source-created' : 'source-reused',
      source.id,
      sourceResolution.created,
    );
    push(sourceResolution.created ? 'created' : 'reused', {
      employerId: employer.id,
      careerSiteId: site.id,
      sourceId: source.id,
      reason: sourceResolution.created
        ? null
        : source.archivedAt !== null
          ? 'Reused archived Source; left disabled'
          : null,
    });
  }

  private resolveEmployer(
    row: ParsedEmployerManifestRow['row'],
  ): EmployerResolution {
    let resolved: ResolvedEmployer | null = null;
    if (row.rootDomain !== undefined) {
      const domain = normalizeDomainIdentity(row.rootDomain);
      if (domain === null) return { kind: 'invalid-domain' };
      const candidates = this.employersByDomain.get(domain) ?? [];
      if (candidates.length > 1) return { kind: 'ambiguous' };
      if (candidates.length === 1) {
        const candidate = candidates[0];
        if (candidate !== undefined) resolved = candidate;
      }
    }
    if (row.employerName !== undefined && resolved !== null) {
      const byName = this.employersByName.get(
        normalizeEmployerName(row.employerName),
      );
      if (byName !== undefined && byName.key !== resolved.key) {
        return { kind: 'ambiguous' };
      }
    }
    if (resolved === null && row.employerName !== undefined) {
      const normalized = normalizeEmployerName(row.employerName);
      resolved ??= this.employersByName.get(normalized) ?? null;
      resolved ??= this.aliasToEmployer.get(normalized) ?? null;
    }
    if (resolved !== null) {
      return { kind: 'resolved', employer: resolved, created: false };
    }
    return {
      kind: 'resolved',
      employer: this.createEmployer(row),
      created: true,
    };
  }

  private createEmployer(
    row: ParsedEmployerManifestRow['row'],
  ): ResolvedEmployer {
    const domain =
      row.rootDomain === undefined
        ? null
        : normalizeDomainIdentity(row.rootDomain);
    const name =
      row.employerName ??
      (domain === null ? 'Unnamed Employer' : deriveNameFromDomain(domain));
    const websiteUrl = domain === null ? null : `https://${domain}`;
    if (this.dryRun) {
      const employer: ResolvedEmployer = {
        key: `new:${normalizeEmployerName(name)}`,
        id: null,
        name: name.trim(),
        normalizedName: normalizeEmployerName(name),
        websiteUrl,
      };
      this.indexEmployer(employer);
      return employer;
    }
    const created = this.employers.createEmployer({
      name: name.trim(),
      websiteUrl,
    });
    const employer: ResolvedEmployer = {
      key: created.id,
      id: created.id,
      name: created.name,
      normalizedName: created.normalizedName,
      websiteUrl: created.websiteUrl,
    };
    this.indexEmployer(employer);
    return employer;
  }

  private indexEmployer(employer: ResolvedEmployer): void {
    if (employer.id !== null) this.employersById.set(employer.id, employer);
    this.employersByName.set(employer.normalizedName, employer);
    if (employer.websiteUrl !== null) {
      const domain = normalizeDomainIdentity(employer.websiteUrl);
      if (domain !== null) {
        pushEmployer(this.employersByDomain, domain, employer);
      }
    }
  }

  private addAlias(
    employer: ResolvedEmployer,
    alias: string,
    provenance: string,
  ): 'added' | 'exists' | 'conflict' {
    const normalized = normalizeEmployerName(alias);
    if (normalized === employer.normalizedName) return 'exists';
    if (this.dryRun) {
      if (this.aliasToEmployer.has(normalized)) return 'exists';
      const canonical = this.employersByName.get(normalized);
      if (canonical !== undefined && canonical.key !== employer.key) {
        return 'conflict';
      }
      this.aliasToEmployer.set(normalized, employer);
      return 'added';
    }
    if (employer.id === null) return 'exists';
    const status = this.employers.addEmployerAlias({
      employerId: employer.id,
      alias,
      provenance,
      observedAt: this.observedAt,
    });
    if (status === 'added') {
      this.aliasToEmployer.set(normalized, employer);
    }
    return status;
  }

  private resolveSite(
    employer: ResolvedEmployer,
    storedUrl: string,
    urlIdentity: string,
    signal: { providerId: string; configuration: ProviderConfiguration } | null,
  ): SiteResolution {
    const site = this.findSiteUnderEmployer(
      employer,
      storedUrl,
      urlIdentity,
      signal,
    );
    if (site !== null) return { kind: 'site', site };
    const claimedByUrl = (this.sitesByUrl.get(storedUrl) ?? []).find(
      (candidate) => candidate.employerKey !== employer.key,
    );
    if (claimedByUrl !== undefined) return { kind: 'ambiguous' };
    if (signal !== null) {
      const atsIdentity = atsTenantIdentity(
        signal.providerId,
        signal.configuration,
      );
      if (atsIdentity !== null) {
        for (const [employerKey, sites] of this.sitesByEmployer) {
          if (employerKey === employer.key) continue;
          for (const candidate of sites.values()) {
            if (
              candidate.providerId === signal.providerId &&
              candidate.atsIdentity === atsIdentity
            ) {
              return { kind: 'ambiguous' };
            }
          }
        }
      }
    }
    return { kind: 'none' };
  }

  private findSiteUnderEmployer(
    employer: ResolvedEmployer,
    storedUrl: string,
    urlIdentity: string,
    signal: { providerId: string; configuration: ProviderConfiguration } | null,
  ): ResolvedSite | null {
    const sites = this.sitesByEmployer.get(employer.key);
    if (sites === undefined || sites.size === 0) return null;
    const byExactUrl = sites.get(storedUrl);
    if (byExactUrl !== undefined) return byExactUrl;
    const byIdentity = [...sites.values()].find(
      (site) => site.identity === urlIdentity,
    );
    if (byIdentity !== undefined) return byIdentity;
    if (signal !== null) {
      const atsIdentity = atsTenantIdentity(
        signal.providerId,
        signal.configuration,
      );
      if (atsIdentity !== null) {
        const byAts = [...sites.values()].find(
          (site) =>
            site.providerId === signal.providerId &&
            site.atsIdentity === atsIdentity,
        );
        if (byAts !== undefined) return byAts;
      }
    }
    const byEffectiveUrl = [...sites.values()].find(
      (site) => site.effectiveUrlIdentity === urlIdentity,
    );
    if (byEffectiveUrl !== undefined) return byEffectiveUrl;
    const evidence = this.evidenceByEmployer.get(employer.key);
    if (evidence !== undefined) {
      for (const [siteKey, details] of evidence) {
        if (details.has(urlIdentity) || details.has(storedUrl)) {
          const byEvidence = [...sites.values()].find(
            (site) => site.key === siteKey,
          );
          if (byEvidence !== undefined) return byEvidence;
        }
      }
    }
    return null;
  }

  private createSite(
    employer: ResolvedEmployer,
    careersUrl: string,
    storedUrl: string,
    row: ParsedEmployerManifestRow['row'],
  ): ResolvedSite {
    if (this.dryRun) {
      const site = hypotheticalSite(employer, careersUrl, storedUrl, row);
      this.indexSite(site);
      return site;
    }
    if (employer.id === null) {
      throw new Error('Cannot create a career site for an unresolved employer');
    }
    const created = this.employers.createCareerSite(employer.id, {
      url: careersUrl,
    });
    this.database
      .prepare('UPDATE career_sites SET discovery_provenance = ? WHERE id = ?')
      .run(row.provenance.slice(0, 120), created.id);
    const site = wrapSite(created);
    site.provenance = row.provenance;
    this.indexSite(site);
    return site;
  }

  private indexSite(site: ResolvedSite): void {
    let employerSites = this.sitesByEmployer.get(site.employerKey);
    if (employerSites === undefined) {
      employerSites = new Map<string, ResolvedSite>();
      this.sitesByEmployer.set(site.employerKey, employerSites);
    }
    employerSites.set(site.normalizedUrl, site);
    const byUrl = this.sitesByUrl.get(site.normalizedUrl);
    if (byUrl === undefined) {
      this.sitesByUrl.set(site.normalizedUrl, [site]);
    } else if (!byUrl.some((candidate) => candidate.key === site.key)) {
      byUrl.push(site);
    }
  }

  private verifyIfNeeded(site: ResolvedSite): void {
    if (this.dryRun || site.id === null) return;
    const current = this.employers.getCareerSite(site.id);
    if (current?.fingerprint !== null) return;
    this.employers.verifyCareerSite(site.id);
  }

  private addImporterEvidence(
    site: ResolvedSite,
    row: ParsedEmployerManifestRow['row'],
  ): void {
    const entries: { kind: string; detail: string; confidence: number }[] = [];
    if (row.provenance.length > 0) {
      entries.push({
        kind: 'manifest-provenance',
        detail: row.provenance,
        confidence: 0.6,
      });
    }
    if (row.batchId !== undefined) {
      entries.push({
        kind: 'manifest-batch',
        detail: row.batchId,
        confidence: 0.5,
      });
    }
    if (row.notes !== undefined) {
      entries.push({
        kind: 'manifest-notes',
        detail: row.notes,
        confidence: 0.5,
      });
    }
    if (row.expectedAtsFamily !== undefined) {
      entries.push({
        kind: 'manifest-expected-ats',
        detail: row.expectedAtsFamily,
        confidence: 0.5,
      });
    }
    if (row.atsTenant !== undefined) {
      entries.push({
        kind: 'manifest-expected-tenant',
        detail: row.atsTenant,
        confidence: 0.5,
      });
    }
    if (row.careersUrl !== undefined) {
      entries.push({
        kind: 'manifest-submitted-url',
        detail: row.careersUrl,
        confidence: 0.6,
      });
    }
    for (const entry of entries) {
      if (this.dryRun || site.id === null) {
        this.pending.evidenceAdded += 1;
        continue;
      }
      const status = this.employers.addCareerSiteEvidence({
        careerSiteId: site.id,
        kind: entry.kind,
        detail: entry.detail,
        confidence: entry.confidence,
        observedAt: this.observedAt,
      });
      if (status === 'added') this.pending.evidenceAdded += 1;
    }
  }

  private recordUnsupported(site: ResolvedSite): void {
    if (this.dryRun) {
      site.discoveryState = 'unsupported';
      site.sourceId = null;
      return;
    }
    if (site.id === null) return;
    const current = this.employers.getCareerSite(site.id);
    if (current === null) return;
    if (
      current.discovery.state === 'unsupported' &&
      current.discovery.sourceId === null
    ) {
      return;
    }
    this.employers.recordDiscoveryAttempt({
      careerSiteId: site.id,
      state: 'unsupported',
      result: 'unsupported',
      providerId: null,
      sourceId: null,
      detail: UNSUPPORTED_DETAIL,
      attemptedAt: this.observedAt,
      nextEligibleAt: null,
    });
  }

  private resolveSource(
    site: ResolvedSite,
    providerId: string,
    configuration: ProviderConfiguration,
    platform: string,
    employerName: string,
    enabled: boolean,
  ): { source: ResolvedSource; created: boolean } {
    if (site.sourceId !== null) {
      const linked = this.sourcesById.get(site.sourceId);
      if (linked !== undefined) return { source: linked, created: false };
    }
    const urlIdentity = site.identity;
    const configJson = canonicalConfigJson(configuration);
    const atsIdentity = atsTenantIdentity(providerId, configuration);
    const candidates = this.allSources.filter(
      (source) => source.providerId === providerId,
    );
    const byUrl = candidates.find(
      (source) =>
        source.careersUrl !== null &&
        normalizeUrlIdentity(source.careersUrl) === urlIdentity,
    );
    const byConfig =
      byUrl ?? candidates.find((source) => source.configJson === configJson);
    const byTenant =
      byConfig ??
      (atsIdentity === null
        ? undefined
        : candidates.find((source) => source.atsIdentity === atsIdentity));
    if (byTenant !== undefined) return { source: byTenant, created: false };
    const source = this.createSource(
      employerName,
      providerId,
      site.url,
      configuration,
      platform,
      enabled,
    );
    return { source, created: true };
  }

  private createSource(
    employerName: string,
    providerId: string,
    careersUrl: string,
    configuration: ProviderConfiguration,
    platform: string,
    enabled: boolean,
  ): ResolvedSource {
    const input: SourceInput = {
      displayName: `${employerName} (${platform})`,
      employer: employerName,
      providerId,
      careersUrl,
      configuration,
      searchCriteria: {
        query: '',
        location: null,
        remoteOnly: false,
        limit: 25,
      },
      enabled,
      schedule: { enabled: false, cadence: 'manual', dailyLocalTime: null },
    };
    if (this.dryRun) {
      const source: ResolvedSource = {
        id: null,
        employer: employerName,
        providerId,
        careersUrl,
        configuration,
        configurationStatus: 'valid',
        enabled,
        archivedAt: null,
        healthStatus: 'never-run',
        configJson: canonicalConfigJson(configuration),
        atsIdentity: atsTenantIdentity(providerId, configuration),
      };
      this.indexSource(source);
      return source;
    }
    const created = this.sources.create(input, 'valid');
    const source = wrapSource(created);
    this.indexSource(source);
    return source;
  }

  private indexSource(source: ResolvedSource): void {
    this.allSources.push(source);
    if (source.id !== null) this.sourcesById.set(source.id, source);
  }

  private recordDiscovery(
    site: ResolvedSite,
    providerId: string,
    state: 'source-created' | 'source-reused',
    sourceId: string | null,
    sourceCreated: boolean,
  ): void {
    if (this.dryRun) {
      site.discoveryState = state;
      site.sourceId = sourceId;
      return;
    }
    if (site.id === null) return;
    const current = this.employers.getCareerSite(site.id);
    if (current === null) return;
    if (
      current.discovery.state === state &&
      current.discovery.sourceId === sourceId
    ) {
      return;
    }
    if (current.discovery.state === state) {
      if (sourceId !== null) {
        this.employers.linkCareerSiteSource(site.id, sourceId, this.observedAt);
      }
      return;
    }
    this.employers.recordDiscoveryAttempt({
      careerSiteId: site.id,
      state,
      result: sourceCreated ? 'source-created' : 'source-reused',
      providerId,
      sourceId,
      detail: sourceCreated
        ? 'Created Source through the manifest import path'
        : 'Reused equivalent Source through the manifest import path',
      attemptedAt: this.observedAt,
      nextEligibleAt: null,
    });
  }

  private commitPending(): void {
    const result = this.result;
    if (result === null) return;
    result.invalid += this.pending.invalid;
    result.inBatchDuplicates += this.pending.inBatchDuplicates;
    result.employersCreated += this.pending.employersCreated;
    result.employersReused += this.pending.employersReused;
    result.careerSitesCreated += this.pending.careerSitesCreated;
    result.careerSitesReused += this.pending.careerSitesReused;
    result.sourcesCreated += this.pending.sourcesCreated;
    result.sourcesReused += this.pending.sourcesReused;
    result.aliasesAdded += this.pending.aliasesAdded;
    result.evidenceAdded += this.pending.evidenceAdded;
    result.unsupportedCandidates += this.pending.unsupportedCandidates;
    result.ambiguousConflicts += this.pending.ambiguousConflicts;
    result.skipped += this.pending.skipped;
    result.enabled += this.pending.enabled;
    result.leftDisabled += this.pending.leftDisabled;
    result.rows.push(...this.pendingRows);
  }

  private rollbackPending(
    chunk: readonly ParsedEmployerManifestRow[],
    batchNumber: number,
    error: unknown,
  ): void {
    const result = this.result;
    if (result === null) return;
    result.batchErrors += 1;
    const message = error instanceof Error ? error.message : String(error);
    for (const identity of this.currentBatchSeen) {
      this.seenUrlIdentities.delete(identity);
    }
    this.rebuildIndexesFromDatabase();
    for (const parsedRow of chunk) {
      result.rows.push({
        index: parsedRow.index,
        status: 'rejected',
        employerName: parsedRow.row.employerName ?? null,
        careersUrl: parsedRow.row.careersUrl ?? null,
        employerId: null,
        careerSiteId: null,
        sourceId: null,
        reason: `Batch ${String(batchNumber)} rolled back after a database error; no changes persisted: ${message}`,
      });
    }
  }
}

function emptyResult(
  version: string,
  dryRun: boolean,
): EmployerManifestImportResult {
  return {
    version,
    dryRun,
    inputRows: 0,
    invalid: 0,
    inBatchDuplicates: 0,
    employersCreated: 0,
    employersReused: 0,
    careerSitesCreated: 0,
    careerSitesReused: 0,
    sourcesCreated: 0,
    sourcesReused: 0,
    aliasesAdded: 0,
    evidenceAdded: 0,
    unsupportedCandidates: 0,
    ambiguousConflicts: 0,
    skipped: 0,
    enabled: 0,
    leftDisabled: 0,
    batches: 0,
    batchErrors: 0,
    rows: [],
  };
}

function zeroPendingCounters(): PendingCounters {
  return {
    invalid: 0,
    inBatchDuplicates: 0,
    employersCreated: 0,
    employersReused: 0,
    careerSitesCreated: 0,
    careerSitesReused: 0,
    sourcesCreated: 0,
    sourcesReused: 0,
    aliasesAdded: 0,
    evidenceAdded: 0,
    unsupportedCandidates: 0,
    ambiguousConflicts: 0,
    skipped: 0,
    enabled: 0,
    leftDisabled: 0,
  };
}

function wrapSite(site: CareerSite): ResolvedSite {
  const signal = detectCareerSiteProvider(site.url);
  return {
    key: site.id,
    id: site.id,
    employerKey: site.employerId,
    url: site.url,
    normalizedUrl: site.normalizedUrl,
    identity: normalizeUrlIdentity(site.url) ?? site.normalizedUrl,
    providerId: signal?.providerId ?? null,
    atsIdentity:
      signal !== null && signal.configuration !== null
        ? atsTenantIdentity(signal.providerId, signal.configuration)
        : null,
    effectiveUrl: site.health.effectiveUrl,
    effectiveUrlIdentity:
      site.health.effectiveUrl === null
        ? null
        : (normalizeUrlIdentity(site.health.effectiveUrl) ??
          site.health.effectiveUrl),
    retired: site.health.status === 'retired',
    discoveryState: site.discovery.state,
    sourceId: site.discovery.sourceId,
    provenance: site.discovery.provenance,
  };
}

function hypotheticalSite(
  employer: ResolvedEmployer,
  careersUrl: string,
  storedUrl: string,
  row: ParsedEmployerManifestRow['row'],
): ResolvedSite {
  const signal = detectCareerSiteProvider(careersUrl);
  const identity = normalizeUrlIdentity(careersUrl) ?? storedUrl;
  return {
    key: `new:${employer.key}:${identity}`,
    id: null,
    employerKey: employer.key,
    url: careersUrl,
    normalizedUrl: storedUrl,
    identity,
    providerId: signal?.providerId ?? null,
    atsIdentity:
      signal !== null && signal.configuration !== null
        ? atsTenantIdentity(signal.providerId, signal.configuration)
        : null,
    effectiveUrl: null,
    effectiveUrlIdentity: null,
    retired: false,
    discoveryState: 'ready',
    sourceId: null,
    provenance: row.provenance,
  };
}

function wrapSource(source: ConfiguredSource): ResolvedSource {
  return {
    id: source.id,
    employer: source.employer,
    providerId: source.providerId,
    careersUrl: source.careersUrl,
    configuration: source.configuration,
    configurationStatus: source.configurationStatus,
    enabled: source.enabled,
    archivedAt: source.archivedAt ?? null,
    healthStatus: source.healthStatus,
    configJson: canonicalConfigJson(source.configuration),
    atsIdentity:
      source.providerId === null
        ? null
        : atsTenantIdentity(source.providerId, source.configuration),
  };
}

function pushEmployer(
  index: Map<string, ResolvedEmployer[]>,
  domain: string,
  employer: ResolvedEmployer,
): void {
  const existing = index.get(domain);
  if (existing === undefined) {
    index.set(domain, [employer]);
  } else if (!existing.some((candidate) => candidate.key === employer.key)) {
    existing.push(employer);
  }
}

function coerceCareersUrl(value: string): string {
  const trimmed = value.trim();
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

function storedNormalizedUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function deriveNameFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? domain;
  const derived = label
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
    .trim();
  return derived.length > 0 ? derived : domain;
}
