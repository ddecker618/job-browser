import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';

import {
  ApplicationService,
  ApplicationServiceError,
} from '../applications/applicationService.js';
import { OutcomeAnalyticsRepository } from '../analytics/outcomeAnalyticsRepository.js';
import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadScoringConfig } from '../config/scoring-config.js';
import { DashboardRepository } from '../database/dashboardRepository.js';
import type { JobDatabase } from '../db/database.js';
import { defaultDatabasePath } from '../db/database.js';
import { persistenceSetCoordinator } from '../db/persistenceSetCoordinator.js';
import { JOB_STATUSES } from '../domain/job-status.js';
import { detectAts, type AtsDetectorOptions } from '../domain/atsDetector.js';
import type { AtsDetectionResult } from '../models/source-management.js';
import type { DiscoveryCoordinator } from '../discovery/discoveryCoordinator.js';
import { EmployerDiscoveryService } from '../discovery/employerDiscoveryService.js';
import { CareerSiteHealthService } from '../discovery/careerSiteHealthService.js';
import { EmployerDiscoveryIntelligenceService } from '../discovery/employerDiscoveryIntelligenceService.js';
import { DiscoveryAlertService } from '../discovery/discoveryAlertService.js';
import { DiscoveryAnalyticsService } from '../discovery/discoveryAnalyticsService.js';
import type { CredentialResolver } from '../discovery/credentialResolver.js';
import {
  ResumeSnapshotCaptureError,
  SNAPSHOT_MANAGED_DIRECTORY,
} from '../domain/resume-snapshot.js';
import { IntelligenceEngine } from '../intelligence/intelligenceEngine.js';
import { createScoreVersion } from '../intelligence/scoreIdentity.js';
import type { AppSettings } from '../models/dashboard.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import {
  DEFAULT_SEARCH_PROFILE,
  searchProfileSchema,
} from '../config/search-profile.js';
import { JobRepository } from '../repositories/job-repository.js';
import { verifyJobAvailability } from '../intelligence/jobAvailability.js';
import { JobSearchRepository } from '../repositories/job-search-repository.js';
import { ResumeSnapshotRepository } from '../repositories/resume-snapshot-repository.js';
import { SourceRepository } from '../repositories/source-repository.js';
import { EmployerRepository } from '../repositories/employerRepository.js';
import {
  employerInputSchema,
  careerSiteInputSchema,
} from '../schemas/employer.js';
import {
  initializeSnapshotStorage,
  reconcileSnapshotStorage,
} from '../resumes/reconcileSnapshots.js';
import {
  captureResumeSnapshot,
  type PreparedResumeSnapshot,
} from '../resumes/resumeSnapshotCapture.js';
import {
  loadUnifiedLegacyPreferences,
  saveUnifiedProfilePreferences,
} from '../preferences/profilePreferencesRuntime.js';
import type { LegacyPreferences } from '../preferences/profilePreferencesAdapters.js';
import {
  extractResume,
  resolveResumeStoragePath,
} from '../resumes/resumeService.js';
import {
  candidateProfileSchema,
  type CandidateProfile,
} from '../schemas/candidate-profile.js';
import { scoringConfigSchema } from '../schemas/scoring-config.js';
import {
  discoverySettingsSchema,
  atsDetectionRequestSchema,
  sourceInputSchema,
} from '../schemas/source-management.js';
import { jobSearchQuerySchema } from '../schemas/job-search.js';
import { enforceLoopbackRequest } from './loopbackSecurity.js';

export interface AppOptions {
  candidateProfilePath?: string;
  scoringConfigPath?: string;
  profilePreferencesPath?: string;
  resumeDirectory?: string;
  snapshotDirectory?: string;
  artifactDirectory?: string;
  databasePath?: string;
  onSettingsSaved?: (settings: AppSettings) => void;
  coordinator?: DiscoveryCoordinator;
  sourceRepository?: SourceRepository;
  employerRepository?: EmployerRepository;
  employerDiscoveryService?: EmployerDiscoveryService;
  careerSiteHealthService?: CareerSiteHealthService;
  employerDiscoveryIntelligence?: EmployerDiscoveryIntelligenceService;
  credentialResolver?: CredentialResolver;
  discoveryAlertService?: DiscoveryAlertService;
  discoveryAnalyticsService?: DiscoveryAnalyticsService;
  apiRequestsPerMinute?: number;
  atsDetector?: (
    url: string,
    options?: AtsDetectorOptions,
  ) => Promise<AtsDetectionResult>;
  availabilityFetcher?: import('../intelligence/jobAvailability.js').AvailabilityFetcher;
}

const asyncRoute =
  (handler: (request: Request, response: Response) => void | Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const result = handler(request, response);
    if (result instanceof Promise) {
      result.catch(next);
    }
  };

export function createApp(
  database: JobDatabase,
  options: AppOptions = {},
): express.Express {
  const app = express();
  const profilePath = options.candidateProfilePath;
  const scoringPath = options.scoringConfigPath;
  const profilePreferencesPath = options.profilePreferencesPath;
  const getCurrentScoreVersion = () =>
    createScoreVersion(
      loadCandidateProfile(profilePath, profilePreferencesPath),
      loadScoringConfig(scoringPath, profilePreferencesPath),
    );
  const repository = new DashboardRepository(database, {
    getScoreVersion: getCurrentScoreVersion,
  });
  const jobRepository = new JobRepository(database);
  const jobSearchRepository = new JobSearchRepository(database, {
    getScoreVersion: () => getCurrentScoreVersion(),
  });
  const applicationService = new ApplicationService(database);
  const outcomeAnalytics = new OutcomeAnalyticsRepository(database);
  const sourceRepository =
    options.sourceRepository ?? new SourceRepository(database);
  const employerRepository =
    options.employerRepository ?? new EmployerRepository(database);
  const employerDiscoveryIntelligence =
    options.employerDiscoveryIntelligence ??
    new EmployerDiscoveryIntelligenceService(database);
  const coordinator = options.coordinator;
  const employerDiscoveryService =
    options.employerDiscoveryService ??
    new EmployerDiscoveryService(
      employerRepository,
      sourceRepository,
      providerRegistry,
      coordinator,
      options.credentialResolver,
      employerDiscoveryIntelligence,
    );
  const careerSiteHealthService =
    options.careerSiteHealthService ??
    new CareerSiteHealthService(employerRepository, employerDiscoveryService);
  const discoveryAlertService =
    options.discoveryAlertService ?? new DiscoveryAlertService(database);
  const discoveryAnalyticsService =
    options.discoveryAnalyticsService ?? new DiscoveryAnalyticsService(database);
  const resumeDirectory =
    options.resumeDirectory ?? resolve(process.cwd(), 'data', 'resumes');
  mkdirSync(resumeDirectory, { recursive: true });
  const snapshotDirectory =
    options.snapshotDirectory ??
    resolve(process.cwd(), 'data', SNAPSHOT_MANAGED_DIRECTORY);
  initializeSnapshotStorage(snapshotDirectory);
  const upload = multer({
    storage: multer.diskStorage({
      destination: resumeDirectory,
      filename: (_request, file, callback) =>
        callback(
          null,
          `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
        ),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  app.use(express.json({ limit: '2mb' }));
  app.use('/api', enforceLoopbackRequest);
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: options.apiRequestsPerMinute ?? 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many API requests; retry in one minute' },
    }),
  );
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  app.get('/api/health', (_request, response) =>
    response.json({ status: 'ok' }),
  );
  app.get('/api/dashboard', (_request, response) =>
    response.json(repository.getSummary()),
  );
  app.get('/api/jobs', (_request, response) =>
    response.json(repository.listJobs()),
  );
  app.get('/api/jobs/search', (request, response) => {
    const query = jobSearchQuerySchema.parse(request.query);
    response.json(jobSearchRepository.search(query));
  });
  app.get('/api/jobs/:id', (request, response) => {
    const job = repository.getJob(request.params.id);
    if (job === null)
      return void response.status(404).json({ error: 'Job not found' });
    if (
      job.active &&
      job.status !== 'expired' &&
      job.scoreVersion !== getCurrentScoreVersion()
    ) {
      return void response.status(409).json({
        error: 'Job score is awaiting reprocessing',
        scoreVersion: job.scoreVersion,
      });
    }
    response.json(job);
  });
  app.patch('/api/jobs/:id/status', (request, response) => {
    const body = z.object({ status: z.enum(JOB_STATUSES) }).parse(request.body);
    jobRepository.changeStatus(request.params.id, {
      status: body.status,
      changedBy: 'dashboard',
      reason: 'Changed from dashboard',
    });
    response.json(repository.getJob(request.params.id));
  });
  app.patch(
    '/api/jobs/:id/availability',
    asyncRoute(async (request, response) => {
      const body = z
        .object({ action: z.enum(['remove', 'restore', 'verify']) })
        .parse(request.body);
      const id = routeParameter(request, 'id');
      const job = repository.getJob(id);
      if (job === null) {
        response.status(404).json({ error: 'Job not found' });
        return;
      }
      if (body.action === 'verify') {
        const outcome = await verifyJobAvailability(
          job.postingUrl,
          options.availabilityFetcher,
        );
        // Only definitive outcomes change lifecycle state. Timeouts, network
        // errors, and other low-confidence failures (reason 'unreachable')
        // must never automatically remove a job (availability safety policy).
        if (outcome.reason !== 'unreachable') {
          jobRepository.recordAvailabilityVerification(id, {
            available: outcome.available,
            changedBy: 'availability-verify',
          });
        }
        response.json({ job: repository.getJob(id), outcome });
        return;
      }
      const changed = jobRepository.setAvailability(id, {
        action: body.action,
        changedBy: 'dashboard',
      });
      response.json({ changed, job: repository.getJob(id) });
    }),
  );
  app.patch('/api/jobs/:id', (request, response) => {
    const body = z
      .object({
        favorite: z.boolean().optional(),
        notes: z.string().max(10_000).nullable().optional(),
      })
      .parse(request.body);
    repository.updateJobMetadata(request.params.id, body.favorite, body.notes);
    response.json(repository.getJob(request.params.id));
  });
  app.get('/api/applications', (request, response) => {
    response
      .status(200)
      .json(applicationService.listApplications(request.query));
  });
  app.get('/api/applications/:applicationId', (request, response) => {
    response
      .status(200)
      .json(
        applicationService.getApplication(
          routeParameter(request, 'applicationId'),
        ),
      );
  });
  app.get('/api/applications/:applicationId/timeline', (request, response) => {
    response
      .status(200)
      .json(
        applicationService.getTimeline(
          routeParameter(request, 'applicationId'),
        ),
      );
  });
  app.get('/api/resume-snapshots/:snapshotId', (request, response) => {
    const snapshot = new ResumeSnapshotRepository(database).findById(
      routeParameter(request, 'snapshotId'),
    );
    if (snapshot === null) {
      response.status(404).json({ error: 'ResumeSnapshot not found' });
      return;
    }
    response.status(200).json(snapshot);
  });
  app.get('/api/resume-snapshots', (_request, response) => {
    const report = reconcileSnapshotStorage(snapshotDirectory, database);
    response.status(200).json({
      snapshots: new ResumeSnapshotRepository(database).listStorageKeys(),
      health: report,
    });
  });
  app.post(
    '/api/applications',
    asyncRoute(async (request, response) => {
      const resumeId = createCommandResumeId(request.body);
      let prepared: PreparedResumeSnapshot | null = null;
      try {
        if (resumeId !== null) {
          prepared = await captureResumeSnapshot({
            database,
            resumeId,
            resumeDirectory,
            snapshotRoot: snapshotDirectory,
            profile: loadCandidateProfile(profilePath, profilePreferencesPath),
            config: loadScoringConfig(scoringPath, profilePreferencesPath),
          });
        }
        const result = applicationService.createApplication(
          request.body,
          prepared,
        );
        if (result.replayed && prepared !== null) prepared.cleanup();
        response.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        prepared?.cleanup();
        throw error;
      }
    }),
  );
  app.post(
    '/api/applications/:applicationId/events',
    asyncRoute(async (request, response) => {
      const resumeId = createCommandResumeId(request.body);
      let prepared: PreparedResumeSnapshot | null = null;
      try {
        if (resumeId !== null) {
          parsedResumeSnapshotTarget(request.body);
          prepared = await captureResumeSnapshot({
            database,
            resumeId,
            resumeDirectory,
            snapshotRoot: snapshotDirectory,
            profile: loadCandidateProfile(profilePath, profilePreferencesPath),
            config: loadScoringConfig(scoringPath, profilePreferencesPath),
          });
        }
        const result = applicationService.appendEvent(
          routeParameter(request, 'applicationId'),
          request.body,
          prepared,
        );
        if (result.replayed && prepared !== null) prepared.cleanup();
        response.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        prepared?.cleanup();
        throw error;
      }
    }),
  );
  app.patch('/api/applications/:applicationId/notes', (request, response) => {
    response
      .status(200)
      .json(
        applicationService.updateSummaryNotes(
          routeParameter(request, 'applicationId'),
          request.body,
        ),
      );
  });
  app.post(
    '/api/jobs/:id/refresh',
    asyncRoute(async (request, response) => {
      const job = repository.getJob(routeParameter(request, 'id'));
      if (job === null) {
        response.status(404).json({ error: 'Job not found' });
        return;
      }
      const providerId = job.sources.find(
        (source) => source.providerId !== null,
      )?.providerId;
      if (providerId === undefined || providerId === null) {
        response.status(409).json({ error: 'Job has no refreshable provider' });
        return;
      }
      const sourceId = job.sources.find(
        (source) => source.providerId === providerId,
      )?.sourceId;
      if (coordinator === undefined || sourceId === undefined) {
        response
          .status(409)
          .json({ error: 'Discovery coordinator is unavailable' });
        return;
      }
      await coordinator.runSource(sourceId, 'manual-job');
      response.json(repository.getJob(job.id));
    }),
  );

  app.get(
    '/api/providers',
    asyncRoute(async (_request, response) => {
      await providerRegistry.loadProviders();
      const providers = await Promise.all(
        providerRegistry.list().map(async (provider) => ({
          id: provider.id,
          name: provider.name,
          type: provider.type,
          capabilities: provider.capabilities,
          credentialStatus: provider.capabilities.requiresCredentials
            ? ((await options.credentialResolver?.status(provider.id)) ?? {
                configured: false,
                available: false,
              })
            : { configured: true, available: true },
          supportState:
            provider.capabilities.interactiveBrowser === true
              ? ('supported-with-configuration' as const)
              : ('supported' as const),
        })),
      );
      response.json(providers);
    }),
  );

  app.post(
    '/api/sources/detect',
    asyncRoute(async (request, response) => {
      const body = atsDetectionRequestSchema.parse(request.body);
      response.json(await (options.atsDetector ?? detectAts)(body.url));
    }),
  );

  app.get('/api/sources/control-center', (_request, response) => {
    const employerDiscovery = sourceRepository.getEmployerDiscoverySettings();
    response.json({
      summary: sourceRepository.summary(),
      sources: sourceRepository.list(),
      recentRuns: sourceRepository.recentRuns(undefined, 12),
      discovery: coordinator?.status() ?? null,
      schedulerEnabled: sourceRepository.getSchedulerEnabled(),
      employerDiscoveryEnabled: employerDiscovery.enabled,
      employerDiscoveryLastEvaluatedAt: employerDiscovery.lastEvaluatedAt,
    });
  });

  app.post(
    '/api/sources/validate',
    asyncRoute(async (request, response) => {
      const body = z
        .strictObject({
          providerId: z.string().min(1),
          configuration: z.record(z.string(), z.unknown()),
        })
        .parse(request.body);
      await providerRegistry.loadProviders();
      response.json(
        await providerRegistry
          .get(body.providerId)
          .validateConfiguration(body.configuration),
      );
    }),
  );

  app.post(
    '/api/sources',
    asyncRoute(async (request, response) => {
      const input = sourceInputSchema.parse(request.body);
      await providerRegistry.loadProviders();
      const provider = providerRegistry.get(input.providerId);
      const validation = await provider.validateConfiguration(
        input.configuration,
      );
      if (!validation.valid) {
        response.status(400).json({ error: validation.message });
        return;
      }
      const credentialStatus = provider.capabilities.requiresCredentials
        ? await options.credentialResolver?.status(provider.id)
        : { configured: true, available: true };
      const status =
        credentialStatus?.configured === false
          ? 'credentials-required'
          : 'valid';
      response.status(201).json(sourceRepository.create(input, status));
    }),
  );

  app.put(
    '/api/sources/:id',
    asyncRoute(async (request, response) => {
      const input = sourceInputSchema.parse(request.body);
      const provider = providerRegistry.get(input.providerId);
      const validation = await provider.validateConfiguration(
        input.configuration,
      );
      if (!validation.valid) {
        response.status(400).json({ error: validation.message });
        return;
      }
      const credentialStatus = provider.capabilities.requiresCredentials
        ? await options.credentialResolver?.status(provider.id)
        : { configured: true };
      const status =
        credentialStatus?.configured === false
          ? 'credentials-required'
          : 'valid';
      response.json(
        sourceRepository.update(routeParameter(request, 'id'), input, status),
      );
    }),
  );

  app.patch('/api/sources/:id/enabled', (request, response) => {
    const body = z.strictObject({ enabled: z.boolean() }).parse(request.body);
    sourceRepository.setEnabled(routeParameter(request, 'id'), body.enabled);
    response.json(sourceRepository.get(routeParameter(request, 'id')));
  });

  app.delete('/api/sources/:id', (request, response) => {
    sourceRepository.delete(routeParameter(request, 'id'));
    response.status(204).end();
  });

  app.post(
    '/api/sources/:id/run',
    asyncRoute(async (request, response) => {
      if (coordinator === undefined)
        throw new Error('Discovery coordinator is unavailable');
      response.json(await coordinator.runSource(routeParameter(request, 'id')));
    }),
  );

  app.post(
    '/api/sources/:id/health',
    asyncRoute(async (request, response) => {
      if (coordinator === undefined)
        throw new Error('Discovery coordinator is unavailable');
      response.json(
        await coordinator.healthCheck(routeParameter(request, 'id')),
      );
    }),
  );

  app.get('/api/sources/:id/runs', (request, response) => {
    response.json(sourceRepository.recentRuns(routeParameter(request, 'id')));
  });

  app.post(
    '/api/discovery/run',
    asyncRoute(async (_request, response) => {
      if (coordinator === undefined)
        throw new Error('Discovery coordinator is unavailable');
      response.json(await coordinator.runAll());
    }),
  );

  app.get('/api/discovery/status', (_request, response) => {
    response.json(coordinator?.status() ?? null);
  });

  app.put('/api/discovery/settings', (request, response) => {
    const body = discoverySettingsSchema.parse(request.body);
    sourceRepository.setSchedulerEnabled(body.schedulerEnabled);
    sourceRepository.setEmployerDiscoveryEnabled(body.employerDiscoveryEnabled);
    response.json({
      schedulerEnabled: sourceRepository.getSchedulerEnabled(),
      employerDiscoveryEnabled:
        sourceRepository.getEmployerDiscoverySettings().enabled,
    });
  });

  app.post('/api/employer-discovery/seeds', (request, response) => {
    const body = z
      .strictObject({
        seeds: z.array(
          z.strictObject({
            name: z.string(),
            websiteUrl: z.url().nullable(),
            careerSiteUrls: z.array(z.string()).max(5),
            provenance: z.string(),
          }),
        ),
      })
      .parse(request.body);
    response.json(employerRepository.importSeeds(body.seeds));
  });

  app.get('/api/profile', (_request, response) =>
    response.json({
      profile: loadCandidateProfile(profilePath, profilePreferencesPath),
      scoring: loadScoringConfig(scoringPath, profilePreferencesPath),
    }),
  );
  app.put(
    '/api/profile',
    asyncRoute(async (request, response) => {
      const body = z
        .object({
          profile: candidateProfileSchema,
          rescore: z.boolean().default(false),
        })
        .parse(request.body);
      await persistenceSetCoordinator.withWrite(() => {
        saveJson(
          profilePath ??
            resolve(process.cwd(), 'config', 'candidate-profile.json'),
          body.profile,
        );
        saveUnified({ candidateProfile: body.profile });
      });
      const summary = new IntelligenceEngine(database).analyze(
        body.profile,
        loadScoringConfig(scoringPath, profilePreferencesPath),
      );
      response.json({ profile: body.profile, analysis: summary });
    }),
  );
  app.put(
    '/api/scoring',
    asyncRoute(async (request, response) => {
      const scoring = scoringConfigSchema.parse(request.body);
      await persistenceSetCoordinator.withWrite(() => {
        saveJson(
          scoringPath ??
            resolve(process.cwd(), 'config', 'scoring-config.json'),
          scoring,
        );
        saveUnified({ scoringConfig: scoring });
      });
      const analysis = new IntelligenceEngine(database).analyze(
        loadCandidateProfile(profilePath, profilePreferencesPath),
        scoring,
      );
      response.json({ scoring, analysis });
    }),
  );

  app.get('/api/resumes', (_request, response) =>
    response.json(repository.listResumes()),
  );
  app.post(
    '/api/resumes',
    upload.single('resume'),
    asyncRoute(async (request, response) => {
      if (request.file === undefined) {
        response.status(400).json({ error: 'Resume file is required' });
        return;
      }
      const profile = loadCandidateProfile(profilePath, profilePreferencesPath);
      const extraction = await extractResume(
        request.file.path,
        request.file.originalname,
        profile,
        loadScoringConfig(scoringPath, profilePreferencesPath),
        resumeDirectory,
      );
      const resume = repository.addResume({
        displayName:
          z
            .object({ displayName: z.string().trim().min(1).optional() })
            .parse(request.body).displayName ?? request.file.originalname,
        originalFilename: request.file.originalname,
        storagePath: request.file.path,
        mimeType: request.file.mimetype,
        sizeBytes: request.file.size,
        parsingStatus: extraction.parsingStatus,
        parsingError: extraction.parsingError,
        extractedSkills: extraction.skills,
        extractedCertifications: extraction.certifications,
      });
      repository.addResumeProposals(
        resume.id,
        extraction.proposedSkills,
        extraction.proposedCertifications,
      );
      response.status(201).json(repository.getResume(resume.id));
    }),
  );
  app.patch('/api/resumes/:id', (request, response) => {
    const body = z
      .object({
        displayName: z.string().trim().min(1).optional(),
        isDefault: z.boolean().optional(),
      })
      .parse(request.body);
    const id = request.params.id;
    if (body.displayName !== undefined)
      repository.renameResume(id, body.displayName);
    if (body.isDefault === true) repository.setDefaultResume(id);
    response.json(repository.getResume(id));
  });
  app.delete(
    '/api/resumes/:id',
    asyncRoute(async (request, response) => {
      const id = routeParameter(request, 'id');
      const storagePath = repository.getResumeStoragePath(id);
      const resolvedStoragePath =
        storagePath === null
          ? null
          : resolveResumeStoragePath(resumeDirectory, storagePath);
      await persistenceSetCoordinator.withWrite(() => {
        repository.deleteResume(id);
        if (resolvedStoragePath !== null && existsSync(resolvedStoragePath))
          unlinkSync(resolvedStoragePath);
      });
      response.status(204).end();
    }),
  );
  app.post('/api/resumes/:id/rescore', (request, response) => {
    const resume = repository.getResume(request.params.id);
    if (resume === null)
      return void response.status(404).json({ error: 'Resume not found' });
    const profile = loadCandidateProfile(profilePath, profilePreferencesPath);
    const mergedProfile: CandidateProfile = {
      ...profile,
      skills: [...new Set([...profile.skills, ...resume.extractedSkills])],
      certifications: [
        ...new Set([
          ...profile.certifications,
          ...resume.extractedCertifications,
        ]),
      ],
    };
    response.json(
      new IntelligenceEngine(database).analyze(
        mergedProfile,
        loadScoringConfig(scoringPath, profilePreferencesPath),
      ),
    );
  });
  app.patch(
    '/api/resume-proposals/:id',
    asyncRoute(async (request, response) => {
      const body = z
        .object({ status: z.enum(['approved', 'rejected']) })
        .parse(request.body);
      const proposal = repository.reviewProposal(
        routeParameter(request, 'id'),
        body.status,
      );
      if (body.status === 'approved') await applyProposals([proposal]);
      response.json(proposal);
    }),
  );
  app.post(
    '/api/resumes/:id/proposals',
    asyncRoute(async (request, response) => {
      const body = z
        .object({ status: z.enum(['approved', 'rejected']) })
        .parse(request.body);
      const proposals = repository.reviewAllProposals(
        routeParameter(request, 'id'),
        body.status,
      );
      if (body.status === 'approved') await applyProposals(proposals);
      response.json(proposals);
    }),
  );

  app.get('/api/analytics', (_request, response) =>
    response.json(repository.getAnalytics()),
  );
  app.get('/api/analytics/application-outcomes', (request, response) => {
    const query = z
      .strictObject({
        start: z.iso.datetime(),
        end: z.iso.datetime(),
      })
      .parse(request.query);
    response.json(outcomeAnalytics.calculate(query.start, query.end));
  });
  app.get('/api/sources', (_request, response) =>
    response.json(repository.listSources()),
  );
  app.get('/api/settings', (_request, response) => {
    const settings = repository.getSettings(
      defaultSettings(
        resumeDirectory,
        options.artifactDirectory ?? resolve(process.cwd(), 'artifacts'),
      ),
    );
    const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
    if (unified !== null) settings.targetRoles = [...unified.sourceQueryRoles];
    settings.databaseLocation =
      options.databasePath ?? defaultDatabasePath();
    response.json(settings);
  });
  app.put('/api/settings', (request, response) => {
    const settings = settingsSchema.parse(request.body);
    options.onSettingsSaved?.(settings);
    repository.saveSettings(settings);
    saveUnified({ sourceQueryRoles: settings.targetRoles });
    if (settings.targetRoles.length > 0) {
      sourceRepository.cascadeTargetRoles(settings.targetRoles);
    }
    response.json(settings);
  });
  app.get('/api/search-profile', (_request, response) => {
    const unified = loadUnifiedLegacyPreferences(profilePreferencesPath);
    if (unified !== null) {
      response.json(unified.searchProfile);
      return;
    }
    const raw = repository.getSetting('searchProfile');
    if (raw === null) return response.json(DEFAULT_SEARCH_PROFILE);
    try {
      const parsed = searchProfileSchema.parse(JSON.parse(raw));
      response.json(parsed);
    } catch {
      response.json(DEFAULT_SEARCH_PROFILE);
    }
  });
  app.put('/api/search-profile', (request, response) => {
    const profile = searchProfileSchema.parse(request.body);
    repository.saveSetting('searchProfile', JSON.stringify(profile));
    saveUnified({ searchProfile: profile });
    sourceRepository.cascadeSearchProfile(profile);
    jobRepository.refreshMatchedFamilies();
    const analysis = new IntelligenceEngine(database).analyze(
      loadCandidateProfile(profilePath, profilePreferencesPath),
      loadScoringConfig(scoringPath, profilePreferencesPath),
    );
    response.json({ profile, analysis });
  });
  app.get('/api/saved-filters', (_request, response) =>
    response.json(repository.listSavedFilters()),
  );
  app.post('/api/saved-filters', (request, response) => {
    const body = z
      .object({
        name: z.string().trim().min(1),
        filters: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
      })
      .parse(request.body);
    response.status(201).json(repository.saveFilter(body.name, body.filters));
  });
  app.delete('/api/saved-filters/:id', (request, response) => {
    repository.deleteFilter(request.params.id);
    response.status(204).end();
  });

  app.use('/api/applications', (_request, response) => {
    response.status(404).json({ error: 'Application endpoint not found' });
  });

  app.get('/api/employers', (_request, response) => {
    response.json(employerRepository.listEmployersWithSites());
  });

  app.get('/api/employer-discovery/intelligence', (request, response) => {
    const query = z
      .strictObject({ asOf: z.iso.datetime().optional() })
      .parse(request.query);
    response.json(
      employerDiscoveryIntelligence.summary(
        query.asOf === undefined ? undefined : new Date(query.asOf),
      ),
    );
  });

  app.get('/api/career-sites/:id/intelligence', (request, response) => {
    const query = z
      .strictObject({ asOf: z.iso.datetime().optional() })
      .parse(request.query);
    const result = employerDiscoveryIntelligence.decision(
      routeParameter(request, 'id'),
      query.asOf === undefined ? undefined : new Date(query.asOf),
    );
    if (result === null) {
      response.status(404).json({ error: 'CareerSite not found' });
      return;
    }
    response.json(result);
  });

  app.post(
    '/api/employer-discovery/run',
    asyncRoute(async (_request, response) => {
      response.json(await employerDiscoveryService.runEligible());
    }),
  );

  app.post(
    '/api/career-sites/:id/discover',
    asyncRoute(async (request, response) => {
      response.json(
        await employerDiscoveryService.runSite(
          routeParameter(request, 'id'),
          true,
        ),
      );
    }),
  );
  app.post(
    '/api/career-sites/:id/health-check',
    asyncRoute(async (request, response) => {
      response.json(
        await careerSiteHealthService.checkSite(routeParameter(request, 'id')),
      );
    }),
  );
  app.post(
    '/api/career-sites/:id/repair',
    asyncRoute(async (request, response) => {
      response.json(
        await careerSiteHealthService.repairSite(routeParameter(request, 'id')),
      );
    }),
  );
  app.post('/api/career-sites/:id/retire', (request, response) => {
    response.json(
      employerRepository.retireCareerSite(routeParameter(request, 'id')),
    );
  });
  app.get('/api/career-sites/:id/verification-history', (request, response) => {
    response.json(
      employerRepository.listVerificationHistory(routeParameter(request, 'id')),
    );
  });
  app.post(
    '/api/career-site-health/run',
    asyncRoute(async (_request, response) => {
      response.json(await careerSiteHealthService.runEligible(25));
    }),
  );

  app.get('/api/discovery/analytics', (request, response) => {
    const windowParam = request.query['window'] as string | undefined;
    let windowHours = 24;
    if (windowParam === '7d') windowHours = 168;
    else if (windowParam === '30d') windowHours = 720;
    response.json(discoveryAnalyticsService.getReport(windowHours));
  });

  app.get('/api/discovery/analytics/sources', (_request, response) => {
    response.json(discoveryAnalyticsService.getSourceAnalytics());
  });

  app.get('/api/discovery/analytics/providers', (_request, response) => {
    response.json(discoveryAnalyticsService.getProviderAnalytics());
  });

  app.get('/api/discovery/alerts', (request, response) => {
    const state = request.query['state'] as 'active' | 'acknowledged' | 'resolved' | undefined;
    response.json(discoveryAlertService.listAlerts(state ? { state } : {}));
  });

  app.get('/api/discovery/alerts/:id', (request, response) => {
    const alert = discoveryAlertService.getAlert(request.params.id);
    if (alert === null) {
      response.status(404).json({ error: 'Alert not found' });
      return;
    }
    response.json(alert);
  });

  app.patch('/api/discovery/alerts/:id/acknowledge', (request, response) => {
    const alert = discoveryAlertService.acknowledgeAlert(request.params.id);
    if (alert === null) {
      response.status(404).json({ error: 'Alert not found' });
      return;
    }
    response.json(alert);
  });

  app.post('/api/discovery/alerts/evaluate', (_request, response) => {
    discoveryAlertService.evaluateRules();
    response.json({ status: 'ok' });
  });

  app.get('/api/employers/:id', (request, response) => {
    const employer = employerRepository.getEmployer(
      routeParameter(request, 'id'),
    );
    if (employer === null)
      return void response.status(404).json({ error: 'Employer not found' });
    const sites = employerRepository.listCareerSites(employer.id);
    response.json({ employer, careerSites: sites });
  });

  app.post(
    '/api/employers',
    asyncRoute((request, response) => {
      const input = employerInputSchema.parse(request.body);
      const employer = employerRepository.createEmployer(input);
      response.status(201).json(employer);
    }),
  );

  app.post(
    '/api/employers/:id/career-sites',
    asyncRoute((request, response) => {
      const employer = employerRepository.getEmployer(
        routeParameter(request, 'id'),
      );
      if (employer === null)
        return void response.status(404).json({ error: 'Employer not found' });
      const input = careerSiteInputSchema.parse(request.body);
      const site = employerRepository.createCareerSite(employer.id, input);
      response.status(201).json(site);
    }),
  );

  app.post(
    '/api/career-sites/:id/verify',
    asyncRoute((request, response) => {
      const site = employerRepository.verifyCareerSite(
        routeParameter(request, 'id'),
      );
      response.json(site);
    }),
  );

  app.post(
    '/api/career-sites/:id/source',
    asyncRoute(async (request, response) => {
      const outcome = await employerDiscoveryService.runSite(
        routeParameter(request, 'id'),
        false,
      );
      if (outcome.site.discovery.sourceId === null) {
        return void response
          .status(409)
          .json({ error: outcome.site.discovery.lastResult });
      }
      response
        .status(outcome.counter === 'sourceCreated' ? 201 : 200)
        .json(sourceRepository.get(outcome.site.discovery.sourceId));
    }),
  );

  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      void next;
      const applicationBodyErrorReason = applicationBodyParserErrorReason(
        error,
        request,
      );
      if (applicationBodyErrorReason !== null) {
        response.status(400).json({
          error: 'Application command validation failed',
          code: 'application_validation_failed',
          details: { reason: applicationBodyErrorReason },
        });
        return;
      }
      if (error instanceof ApplicationServiceError) {
        response.status(error.status).json({
          error: error.message,
          code: error.code,
          details: error.details,
        });
        return;
      }
      if (error instanceof ResumeSnapshotCaptureError) {
        response.status(error.status).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      response
        .status(error instanceof z.ZodError ? 400 : 500)
        .json({ error: message });
    },
  );

  return app;

  async function applyProposals(
    proposals: readonly {
      fieldName: 'skills' | 'certifications';
      proposedValue: string;
      status: string;
    }[],
  ): Promise<void> {
    const approved = proposals.filter(
      (proposal) => proposal.status === 'approved',
    );
    if (approved.length === 0) return;
    const profile = loadCandidateProfile(profilePath, profilePreferencesPath);
    const skills = new Set(profile.skills);
    const certifications = new Set(profile.certifications);
    for (const proposal of approved) {
      if (proposal.fieldName === 'skills') skills.add(proposal.proposedValue);
      else certifications.add(proposal.proposedValue);
    }
    await persistenceSetCoordinator.withWrite(() => {
      saveJson(
        profilePath ??
          resolve(process.cwd(), 'config', 'candidate-profile.json'),
        {
          ...profile,
          skills: [...skills],
          certifications: [...certifications],
        },
      );
      saveUnified({
        candidateProfile: {
          ...profile,
          skills: [...skills],
          certifications: [...certifications],
        },
      });
    });
  }

  function saveUnified(overrides: Partial<LegacyPreferences>): void {
    if (profilePreferencesPath === undefined) return;
    const current = loadUnifiedLegacyPreferences(profilePreferencesPath) ?? {
      candidateProfile: loadCandidateProfile(profilePath),
      searchProfile: loadLegacySearchProfile(),
      sourceQueryRoles: loadLegacyTargetRoles(),
      scoringConfig: loadScoringConfig(scoringPath),
    };
    saveUnifiedProfilePreferences(profilePreferencesPath, {
      ...current,
      ...overrides,
    });
  }

  function loadLegacySearchProfile() {
    const raw = repository.getSetting('searchProfile');
    if (raw === null) return DEFAULT_SEARCH_PROFILE;
    try {
      return searchProfileSchema.parse(JSON.parse(raw));
    } catch {
      return DEFAULT_SEARCH_PROFILE;
    }
  }

  function loadLegacyTargetRoles(): string[] {
    const raw = repository.getSetting('targetRoles');
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed.every((role): role is string => typeof role === 'string')
        )
          return parsed;
      } catch {
        // Use neutral defaults below.
      }
    }
    return [
      'Systems Administrator',
      'Network Administrator',
      'SOC Analyst',
      'Technical Support Engineer',
    ];
  }
}

const settingsSchema = z.strictObject({
  databaseLocation: z.string().trim().min(1),
  defaultSearch: z.string(),
  theme: z.enum(['dark', 'light']),
  defaultSort: z.enum(['score', 'newest', 'company']),
  loggingLevel: z.enum(['debug', 'info', 'warn', 'error']),
  resumeDirectory: z.string().trim().min(1),
  artifactDirectory: z.string().trim().min(1),
  targetRoles: z
    .array(z.string().trim().min(1))
    .min(1)
    .default([
      'Systems Administrator',
      'Network Administrator',
      'SOC Analyst',
      'Technical Support Engineer',
    ]),
});

function defaultSettings(
  resumeDirectory: string,
  artifactDirectory: string,
): AppSettings {
  return {
    databaseLocation: defaultDatabasePath(),
    defaultSearch: '',
    theme: 'dark',
    defaultSort: 'score',
    loggingLevel: 'info',
    resumeDirectory,
    artifactDirectory,
    targetRoles: [
      'Systems Administrator',
      'Network Administrator',
      'SOC Analyst',
      'Technical Support Engineer',
    ],
  };
}

function saveJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function routeParameter(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function createCommandResumeId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const resumeId = (body as Record<string, unknown>)['resumeId'];
  return typeof resumeId === 'string' && resumeId.trim().length > 0
    ? resumeId
    : null;
}

function parsedResumeSnapshotTarget(body: unknown): void {
  if (typeof body !== 'object' || body === null) return;
  const command = body as Record<string, unknown>;
  if (
    command['kind'] !== 'replace' ||
    command['replacementEventType'] !== 'applied'
  ) {
    throw new ResumeSnapshotCaptureError(
      'A Resume snapshot can only be attached to an Applied event',
      'snapshot_unsupported_association',
      {},
      400,
    );
  }
}

function applicationBodyParserErrorReason(
  error: unknown,
  request: Request,
): string | null {
  const path = request.originalUrl.split('?', 1)[0] ?? '';
  if (path !== '/api/applications' && !path.startsWith('/api/applications/')) {
    return null;
  }
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return null;
  }
  switch (error.type) {
    case 'entity.parse.failed':
      return 'Request body must contain valid JSON';
    case 'entity.too.large':
      return 'Request body exceeds the allowed size';
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return 'Request body uses an unsupported character encoding';
    case 'entity.verify.failed':
    case 'request.aborted':
    case 'request.size.invalid':
      return 'Request body could not be read';
    default:
      return null;
  }
}
