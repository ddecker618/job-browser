import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer from 'multer';
import { z } from 'zod';

import { loadCandidateProfile } from '../config/candidate-profile.js';
import { loadScoringConfig } from '../config/scoring-config.js';
import { DashboardRepository } from '../database/dashboardRepository.js';
import type { JobDatabase } from '../db/database.js';
import { defaultDatabasePath } from '../db/database.js';
import { JOB_STATUSES } from '../domain/job-status.js';
import { detectAts, type AtsDetectorOptions } from '../domain/atsDetector.js';
import type { AtsDetectionResult } from '../models/source-management.js';
import type { DiscoveryCoordinator } from '../discovery/discoveryCoordinator.js';
import type { CredentialResolver } from '../discovery/credentialResolver.js';
import { IntelligenceEngine } from '../intelligence/intelligenceEngine.js';
import type { AppSettings } from '../models/dashboard.js';
import { providerRegistry } from '../providers/providerRegistry.js';
import {
  DEFAULT_SEARCH_PROFILE,
  searchProfileSchema,
  type SearchProfile,
} from '../config/search-profile.js';
import { JobRepository } from '../repositories/job-repository.js';
import { JobSearchRepository } from '../repositories/job-search-repository.js';
import { SourceRepository } from '../repositories/source-repository.js';
import { extractResume } from '../resumes/resumeService.js';
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
  resumeDirectory?: string;
  artifactDirectory?: string;
  onSettingsSaved?: (settings: AppSettings) => void;
  coordinator?: DiscoveryCoordinator;
  sourceRepository?: SourceRepository;
  credentialResolver?: CredentialResolver;
  atsDetector?: (
    url: string,
    options?: AtsDetectorOptions,
  ) => Promise<AtsDetectionResult>;
}

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response).catch(next);
  };

export function createApp(
  database: JobDatabase,
  options: AppOptions = {},
): express.Express {
  const app = express();
  const repository = new DashboardRepository(database);
  const jobRepository = new JobRepository(database);
  const jobSearchRepository = new JobSearchRepository(database);
  const sourceRepository =
    options.sourceRepository ?? new SourceRepository(database);
  const coordinator = options.coordinator;
  const profilePath = options.candidateProfilePath;
  const scoringPath = options.scoringConfigPath;
  const resumeDirectory =
    options.resumeDirectory ?? resolve(process.cwd(), 'data', 'resumes');
  mkdirSync(resumeDirectory, { recursive: true });
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
    response.json({
      summary: sourceRepository.summary(),
      sources: sourceRepository.list(),
      recentRuns: sourceRepository.recentRuns(undefined, 12),
      discovery: coordinator?.status() ?? null,
      schedulerEnabled: sourceRepository.getSchedulerEnabled(),
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
    response.json({ schedulerEnabled: sourceRepository.getSchedulerEnabled() });
  });

  app.get('/api/profile', (_request, response) =>
    response.json({
      profile: loadCandidateProfile(profilePath),
      scoring: loadScoringConfig(scoringPath),
    }),
  );
  app.put('/api/profile', (request, response) => {
    const body = z
      .object({
        profile: candidateProfileSchema,
        rescore: z.boolean().default(false),
      })
      .parse(request.body);
    saveJson(
      profilePath ?? resolve(process.cwd(), 'config', 'candidate-profile.json'),
      body.profile,
    );
    const summary = body.rescore
      ? new IntelligenceEngine(database).analyze(
          body.profile,
          loadScoringConfig(scoringPath),
        )
      : null;
    response.json({ profile: body.profile, analysis: summary });
  });
  app.put('/api/scoring', (request, response) => {
    const scoring = scoringConfigSchema.parse(request.body);
    saveJson(
      scoringPath ?? resolve(process.cwd(), 'config', 'scoring-config.json'),
      scoring,
    );
    response.json(scoring);
  });

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
      const profile = loadCandidateProfile(profilePath);
      const extraction = await extractResume(
        request.file.path,
        request.file.originalname,
        profile,
        loadScoringConfig(scoringPath),
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
  app.delete('/api/resumes/:id', (request, response) => {
    const id = request.params.id;
    const storagePath = repository.getResumeStoragePath(id);
    repository.deleteResume(id);
    if (storagePath !== null && existsSync(storagePath))
      unlinkSync(storagePath);
    response.status(204).end();
  });
  app.post('/api/resumes/:id/rescore', (request, response) => {
    const resume = repository.getResume(request.params.id);
    if (resume === null)
      return void response.status(404).json({ error: 'Resume not found' });
    const profile = loadCandidateProfile(profilePath);
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
        loadScoringConfig(scoringPath),
      ),
    );
  });
  app.patch('/api/resume-proposals/:id', (request, response) => {
    const body = z
      .object({ status: z.enum(['approved', 'rejected']) })
      .parse(request.body);
    const proposal = repository.reviewProposal(request.params.id, body.status);
    if (body.status === 'approved') applyProposals([proposal]);
    response.json(proposal);
  });
  app.post('/api/resumes/:id/proposals', (request, response) => {
    const body = z
      .object({ status: z.enum(['approved', 'rejected']) })
      .parse(request.body);
    const proposals = repository.reviewAllProposals(
      request.params.id,
      body.status,
    );
    if (body.status === 'approved') applyProposals(proposals);
    response.json(proposals);
  });

  app.get('/api/analytics', (_request, response) =>
    response.json(repository.getAnalytics()),
  );
  app.get('/api/sources', (_request, response) =>
    response.json(repository.listSources()),
  );
  app.get('/api/settings', (_request, response) =>
    response.json(
      repository.getSettings(
        defaultSettings(
          resumeDirectory,
          options.artifactDirectory ?? resolve(process.cwd(), 'artifacts'),
        ),
      ),
    ),
  );
  app.put('/api/settings', (request, response) => {
    const settings = settingsSchema.parse(request.body);
    repository.saveSettings(settings);
    if (settings.targetRoles.length > 0) {
      sourceRepository.cascadeTargetRoles(settings.targetRoles);
    }
    options.onSettingsSaved?.(settings);
    response.json(settings);
  });
  app.get('/api/search-profile', (_request, response) => {
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
    sourceRepository.cascadeSearchProfile(profile);
    response.json(profile);
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

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      void next;
      const message = error instanceof Error ? error.message : String(error);
      response
        .status(error instanceof z.ZodError ? 400 : 500)
        .json({ error: message });
    },
  );

  return app;

  function applyProposals(
    proposals: readonly {
      fieldName: 'skills' | 'certifications';
      proposedValue: string;
      status: string;
    }[],
  ): void {
    const approved = proposals.filter(
      (proposal) => proposal.status === 'approved',
    );
    if (approved.length === 0) return;
    const profile = loadCandidateProfile(profilePath);
    const skills = new Set(profile.skills);
    const certifications = new Set(profile.certifications);
    for (const proposal of approved) {
      if (proposal.fieldName === 'skills') skills.add(proposal.proposedValue);
      else certifications.add(proposal.proposedValue);
    }
    saveJson(
      profilePath ?? resolve(process.cwd(), 'config', 'candidate-profile.json'),
      {
        ...profile,
        skills: [...skills],
        certifications: [...certifications],
      },
    );
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
  targetRoles: z.array(z.string().trim().min(1)).min(1).default([
    'systems administrator',
    'network administrator',
    'network analyst',
    'SOC analyst',
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
      'systems administrator',
      'network administrator',
      'network analyst',
      'SOC analyst',
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
