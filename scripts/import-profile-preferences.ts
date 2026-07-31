import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import Database from 'better-sqlite3';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import type { CandidateProfile } from '../src/schemas/candidate-profile.js';
import {
  collectEnabledTitles,
  DEFAULT_SEARCH_PROFILE,
  familiesForJobTitle,
  searchProfileSchema,
  titleMatchScore,
  type SearchProfile,
} from '../src/config/search-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import type { ScoringConfig } from '../src/schemas/scoring-config.js';
import type { JobForScoring } from '../src/domain/job.js';
import {
  fromLegacyPreferences,
  toLegacyPreferences,
  type LegacyPreferences,
} from '../src/preferences/profilePreferencesAdapters.js';
import { ProfilePreferencesStore } from '../src/preferences/profilePreferencesStore.js';
import { createScoreInputHash, createScoreVersion } from '../src/intelligence/scoreIdentity.js';
import type { VerificationResult } from '../src/intelligence/verificationService.js';

const DEFAULT_TARGET_ROLES = [
  'systems administrator',
  'network administrator',
  'network analyst',
  'SOC analyst',
];
const BROWSER_PROFILE_DIRECTORIES = [
  'linkedin-profile',
  'dice-profile',
  'indeed-profile',
  'wellfound-profile',
  'ziprecruiter-profile',
];
const LEGACY_SETTINGS_FILES = [
  'candidate-profile.json',
  'scoring-config.json',
  'runtime.json',
] as const;
const DATABASE_PATH_TRACE = {
  reads: [
    {
      file: 'src/desktop/paths.ts',
      line: 52,
      effect: 'reads runtime.json databasePath before backend startup',
    },
    {
      file: 'src/desktop/main.ts',
      line: 80,
      effect: 'accepts optional JOB_BROWSER_DB_PATH override',
    },
    {
      file: 'src/desktop/backendManager.ts',
      line: 22,
      effect: 'passes resolved paths.database to startBackend',
    },
    {
      file: 'src/server/backend.ts',
      line: 66,
      effect: 'opens the database from options.databasePath',
    },
    {
      file: 'src/database/dashboardRepository.ts',
      line: 615,
      effect: 'reads app_settings for API settings display',
    },
    {
      file: 'src/server/app.ts',
      line: 498,
      effect: 'serves app_settings through GET /api/settings',
    },
  ],
  writes: [
    {
      file: 'src/server/app.ts',
      line: 509,
      effect: 'persists app settings through DashboardRepository',
    },
    {
      file: 'src/database/dashboardRepository.ts',
      line: 647,
      effect: 'writes app_settings rows',
    },
    {
      file: 'src/desktop/backendManager.ts',
      line: 44,
      effect: 'mirrors settings.databaseLocation into runtime.json',
    },
    {
      file: 'src/desktop/paths.ts',
      line: 119,
      effect: 'writes runtime.json databasePath',
    },
  ],
} as const;

interface SettingRow {
  setting_key: string;
  setting_value_json: string;
}

interface FileFingerprint {
  exists: boolean;
  size: number | null;
  sha256: string | null;
}

type ProtectedManifest = Record<string, FileFingerprint>;

class StopStage0B extends Error {
  public constructor(public readonly code: string) {
    super(code);
  }
}

const userDataPath = requiredEnvironment('JOB_BROWSER_USER_DATA');
const backupDirectory = requiredEnvironment('JOB_BROWSER_STAGE0B_BACKUP');

run()
  .then((result) => {
    console.log('STAGE0B_IMPORTED=1');
    console.log('TARGET_FILE_CREATED=1');
    console.log(`CANDIDATE_FIELD_COUNT=${String(result.fieldCounts.candidate)}`);
    console.log(`JOB_PREFERENCE_FIELD_COUNT=${String(result.fieldCounts.jobPreferences)}`);
    console.log(`ROLE_FAMILY_COUNT=${String(result.fieldCounts.roleFamilies)}`);
    console.log(`SOURCE_QUERY_ROLE_COUNT=${String(result.fieldCounts.sourceQueryRoles)}`);
    console.log(`SCORING_FIELD_COUNT=${String(result.fieldCounts.scoring)}`);
    console.log('ADAPTERS_DEEPLY_EQUIVALENT=1');
    console.log('PROTECTED_FILES_UNCHANGED=1');
    console.log(`SCORE_VERSION_HASH=${result.scoreVersion}`);
    console.log(`FIXED_SCORE_INPUT_HASH=${result.fixedScoreInputHash}`);
    console.log('REPORT_WRITTEN=1');
  })
  .catch((error: unknown) => {
    const code = error instanceof StopStage0B ? error.code : 'UNEXPECTED_ERROR';
    console.error(`STAGE0B_STOP=${code}`);
    process.exitCode = 1;
  });

async function run(): Promise<{
  fieldCounts: {
    candidate: number;
    jobPreferences: number;
    roleFamilies: number;
    sourceQueryRoles: number;
    scoring: number;
  };
  scoreVersion: string;
  fixedScoreInputHash: string;
}> {
  const settingsPath = join(userDataPath, 'settings');
  const targetPath = join(settingsPath, 'profile-preferences.json');
  if (existsSync(targetPath)) throw new StopStage0B('TARGET_ALREADY_EXISTS');
  assertBackupExists();

  const runtime = readJsonFile(join(settingsPath, 'runtime.json'), 'RUNTIME_INVALID');
  const runtimeDatabasePath = runtimeDatabasePathFromJson(runtime);
  if (!isAbsolute(runtimeDatabasePath))
    throw new StopStage0B('RELATIVE_RUNTIME_DATABASE_PATH');

  const baselineManifest = await snapshotProtectedFiles(
    userDataPath,
    runtimeDatabasePath,
    targetPath,
  );
  const loaded = loadEffectiveSources(settingsPath, runtimeDatabasePath);
  const document = fromLegacyPreferences(loaded.legacy);
  const restored = toLegacyPreferences(document);
  const comparison = buildComparison(loaded, restored, document);
  if (!comparison.allDeeplyEquivalent)
    throw new StopStage0B('EFFECTIVE_PROFILE_VALUES_NOT_EQUIVALENT');
  if (!comparison.ordering.allBehavioralSequencesPreserved)
    throw new StopStage0B('BEHAVIORAL_ORDERING_CHANGED');
  if (!comparison.fixedFixture.equivalent)
    throw new StopStage0B('FIXED_SCORE_INPUT_HASH_CHANGED');
  if (!comparison.runtimeReadPathVerified)
    throw new StopStage0B('LEGACY_RUNTIME_READ_PATH_NOT_CONFIRMED');

  const beforeWriteManifest = await snapshotProtectedFiles(
    userDataPath,
    runtimeDatabasePath,
    targetPath,
  );
  if (!manifestsEqual(baselineManifest, beforeWriteManifest))
    throw new StopStage0B('PROTECTED_FILE_CHANGED_BEFORE_WRITE');
  if (existsSync(targetPath)) throw new StopStage0B('TARGET_CREATED_CONCURRENTLY');

  const store = new ProfilePreferencesStore(targetPath);
  store.save(document);
  let createdTarget = true;
  try {
    const saved = store.load();
    if (saved === null || !deepEqual(saved, document))
      throw new StopStage0B('WRITTEN_DOCUMENT_NOT_EQUIVALENT');

    const afterWriteManifest = await snapshotProtectedFiles(
      userDataPath,
      runtimeDatabasePath,
      targetPath,
    );
    if (!manifestsEqual(baselineManifest, afterWriteManifest))
      throw new StopStage0B('PROTECTED_FILE_CHANGED_AFTER_WRITE');

    const report = createReport(
      loaded,
      comparison,
      document,
      baselineManifest,
      afterWriteManifest,
      runtime,
      runtimeDatabasePath,
    );
    writeFileSync(
      join(backupDirectory, 'stage0b-integrity-manifest.json'),
      `${JSON.stringify({ before: baselineManifest, after: afterWriteManifest }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(backupDirectory, 'stage0b-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    createdTarget = false;
    return {
      fieldCounts: report.importedFieldCounts,
      scoreVersion: report.scoreVersionHash,
      fixedScoreInputHash: report.fixedFixture.scoreInputHash,
    };
  } catch (error) {
    if (createdTarget && existsSync(targetPath)) unlinkSync(targetPath);
    throw error;
  }
}

function loadEffectiveSources(
  settingsPath: string,
  databasePath: string,
): {
  legacy: LegacyPreferences;
  databasePathAudit: DatabasePathAudit;
} {
  const candidateProfile = loadCandidateProfile(
    join(settingsPath, 'candidate-profile.json'),
  );
  const scoringConfig = loadScoringConfig(
    join(settingsPath, 'scoring-config.json'),
  );
  const database = openDatabaseReadOnly(databasePath);
  try {
    const settings = new Map(
      database
        .prepare<[], SettingRow>(
          'SELECT setting_key, setting_value_json FROM app_settings',
        )
        .all()
        .map((row) => [row.setting_key, parseSetting(row.setting_value_json)]),
    );
    const searchProfile = effectiveSearchProfile(settings.get('searchProfile'));
    const sourceQueryRoles = effectiveTargetRoles(settings.get('targetRoles'));
    if (
      sourceQueryRoles.some(
        (role) => role.length === 0 || role !== role.trim(),
      )
    )
      throw new StopStage0B('TARGET_ROLES_REQUIRE_NORMALIZATION');

    return {
      legacy: {
        candidateProfile,
        searchProfile,
        sourceQueryRoles,
        scoringConfig,
      },
      databasePathAudit: createDatabasePathAudit(
        settings.get('databaseLocation'),
        databasePath,
      ),
    };
  } finally {
    database.close();
  }
}

function openDatabaseReadOnly(databasePath: string): Database.Database {
  try {
    return new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch {
    throw new StopStage0B('PRODUCTION_DATABASE_READ_FAILED');
  }
}

function effectiveSearchProfile(value: unknown): SearchProfile {
  if (value === undefined) return searchProfileSchema.parse(DEFAULT_SEARCH_PROFILE);
  const parsed = searchProfileSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : searchProfileSchema.parse(DEFAULT_SEARCH_PROFILE);
}

function effectiveTargetRoles(value: unknown): string[] {
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((role): role is string => typeof role === 'string')
  )
    return [...value];
  return [...DEFAULT_TARGET_ROLES];
}

function parseSetting(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new StopStage0B('APP_SETTING_JSON_INVALID');
  }
}

function runtimeDatabasePathFromJson(runtime: Record<string, unknown>): string {
  const value = runtime['databasePath'];
  return typeof value === 'string' && value.length > 0
    ? value
    : join(userDataPath, 'data', 'jobs.sqlite');
}

function readJsonFile(path: string, errorCode: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (typeof value !== 'object' || value === null) throw new Error('invalid');
    return value as Record<string, unknown>;
  } catch {
    throw new StopStage0B(errorCode);
  }
}

function assertBackupExists(): void {
  if (!existsSync(backupDirectory))
    throw new StopStage0B('BACKUP_DIRECTORY_MISSING');
  for (const name of LEGACY_SETTINGS_FILES) {
    if (!existsSync(join(backupDirectory, name)))
      throw new StopStage0B(`BACKUP_FILE_MISSING_${name}`);
  }
}

interface AdapterComparison {
  deeplyEquivalent: boolean;
  oldHash: string;
  newHash: string;
}

interface SequenceComparison extends AdapterComparison {
  count: number;
  preserved: boolean;
}

interface DatabasePathAudit {
  runtimeJsonPath: string;
  appSettingsPath: string;
  exactValuesMatch: boolean;
  normalizedPathsMatch: boolean;
  startupSelector: string;
}

function buildComparison(
  loaded: {
    legacy: LegacyPreferences;
    databasePathAudit: DatabasePathAudit;
  },
  restored: LegacyPreferences,
  document: ReturnType<typeof fromLegacyPreferences>,
) {
  const candidateProfile = adapterComparison(
    loaded.legacy.candidateProfile,
    restored.candidateProfile,
  );
  const searchProfile = adapterComparison(
    loaded.legacy.searchProfile,
    restored.searchProfile,
  );
  const scoringConfig = adapterComparison(
    loaded.legacy.scoringConfig,
    restored.scoringConfig,
  );
  const sourceQueryRoles = adapterComparison(
    loaded.legacy.sourceQueryRoles,
    restored.sourceQueryRoles,
  );
  const candidateArrayFields = Object.fromEntries(
    (
      [
        'preferredLocations',
        'certifications',
        'degrees',
        'skills',
        'desiredJobTitles',
        'excludedJobTitles',
        'desiredEmploymentTypes',
      ] as const
    ).map((field) => [
      field,
      sequenceComparison(
        loaded.legacy.candidateProfile[field],
        restored.candidateProfile[field],
      ),
    ]),
  ) as Record<string, SequenceComparison>;
  const roleFamilies = sequenceComparison(
    loaded.legacy.searchProfile.families,
    restored.searchProfile.families,
  );
  const roleFamilyTitles = sequenceComparison(
    loaded.legacy.searchProfile.families.map((family) => family.titles),
    restored.searchProfile.families.map((family) => family.titles),
  );
  const roleFamilyQueries = sequenceComparison(
    collectEnabledTitles(loaded.legacy.searchProfile),
    collectEnabledTitles(restored.searchProfile),
  );
  const sourceQueries = sequenceComparison(
    generatedDiscoveryQueries(loaded.legacy.sourceQueryRoles),
    generatedDiscoveryQueries(restored.sourceQueryRoles),
  );
  const sourceQueryRolesOrdering = sequenceComparison(
    loaded.legacy.sourceQueryRoles,
    restored.sourceQueryRoles,
  );
  const scoringSkills = sequenceComparison(
    loaded.legacy.scoringConfig.skills,
    restored.scoringConfig.skills,
  );
  const scoringCertifications = sequenceComparison(
    loaded.legacy.scoringConfig.certifications,
    restored.scoringConfig.certifications,
  );
  const roleMatching = adapterComparison(
    {
      families: familiesForJobTitle('Security Analyst', loaded.legacy.searchProfile),
      score: titleMatchScore('Security Analyst', loaded.legacy.searchProfile),
    },
    {
      families: familiesForJobTitle('Security Analyst', restored.searchProfile),
      score: titleMatchScore('Security Analyst', restored.searchProfile),
    },
  );
  const orderingSequences = [
    ...Object.values(candidateArrayFields),
    roleFamilies,
    roleFamilyTitles,
    roleFamilyQueries,
    sourceQueryRolesOrdering,
    sourceQueries,
    scoringSkills,
    scoringCertifications,
  ];
  const fixedFixture = createFixedFixtureComparison(
    loaded.legacy.candidateProfile,
    loaded.legacy.scoringConfig,
    restored.candidateProfile,
    restored.scoringConfig,
  );
  const runtimeReadPathVerified = verifyLegacyRuntimeReadPath();
  const sectionEquivalence = {
    candidate: deepEqual(document.candidate, {
      id: loaded.legacy.candidateProfile.id,
      name: loaded.legacy.candidateProfile.name,
      skills: loaded.legacy.candidateProfile.skills,
      certifications: loaded.legacy.candidateProfile.certifications,
      degrees: loaded.legacy.candidateProfile.degrees,
      clearanceEligibility: loaded.legacy.candidateProfile.clearanceEligibility,
      yearsOfExperience: loaded.legacy.candidateProfile.yearsOfExperience,
    }),
    jobPreferences: deepEqual(document.jobPreferences, {
      preferredLocations: loaded.legacy.candidateProfile.preferredLocations,
      searchRadiusMiles: loaded.legacy.candidateProfile.searchRadiusMiles,
      secondarySearchRadiusMiles:
        loaded.legacy.candidateProfile.secondarySearchRadiusMiles,
      remotePreference: loaded.legacy.candidateProfile.remotePreference,
      desiredSalary: loaded.legacy.candidateProfile.desiredSalary,
      desiredJobTitles: loaded.legacy.candidateProfile.desiredJobTitles,
      excludedJobTitles: loaded.legacy.candidateProfile.excludedJobTitles,
      desiredEmploymentTypes: loaded.legacy.candidateProfile.desiredEmploymentTypes,
      education: {
        degreeRequired: loaded.legacy.candidateProfile.degreeRequired,
        degreeInProgressOk: loaded.legacy.candidateProfile.degreeInProgressOk,
      },
      travel: {
        maxTravelPercent: loaded.legacy.candidateProfile.maxTravelPercent,
      },
      schedule: {
        noWeekends: loaded.legacy.candidateProfile.noWeekends,
        noOnCall: loaded.legacy.candidateProfile.noOnCall,
        noRotatingShifts: loaded.legacy.candidateProfile.noRotatingShifts,
        noOvernightShifts: loaded.legacy.candidateProfile.noOvernightShifts,
      },
    }),
    discovery: deepEqual(document.discovery, {
      roleFamilies: loaded.legacy.searchProfile.families,
      sourceQueryRoles: loaded.legacy.sourceQueryRoles,
      prioritizeRemote: loaded.legacy.searchProfile.prioritizeRemote,
      maxOnsiteDistanceMiles: loaded.legacy.searchProfile.maxOnsiteDistanceMiles,
      preferredLocation: loaded.legacy.searchProfile.preferredLocation,
      maxExperienceYears: loaded.legacy.searchProfile.maxExperienceYears,
      maxQueriesPerRun: loaded.legacy.searchProfile.maxQueriesPerRun,
    }),
    scoring: deepEqual(document.scoring, loaded.legacy.scoringConfig),
  };
  return {
    allDeeplyEquivalent:
      candidateProfile.deeplyEquivalent &&
      searchProfile.deeplyEquivalent &&
      scoringConfig.deeplyEquivalent &&
      sourceQueryRoles.deeplyEquivalent &&
      Object.values(sectionEquivalence).every(Boolean) &&
      deepEqual(document, fromLegacyPreferences(restored)),
    ordering: {
      allBehavioralSequencesPreserved: orderingSequences.every(
        (sequence) => sequence.preserved,
      ),
      candidateArrayFields,
      roleFamilies,
      roleFamilyTitles,
      roleFamilyQueries,
      sourceQueryRoles: sourceQueryRolesOrdering,
      sourceQueries,
      scoringSkills,
      scoringCertifications,
    },
    adapterOutputs: {
      candidateProfile,
      searchProfile,
      scoringConfig,
      sourceQueryRoles,
    },
    roleMatching,
    fixedFixture,
    sectionEquivalence,
    runtimeReadPathVerified,
  };
}

function adapterComparison(left: unknown, right: unknown): AdapterComparison {
  return {
    deeplyEquivalent: deepEqual(left, right),
    oldHash: hashValue(left),
    newHash: hashValue(right),
  };
}

function sequenceComparison(left: unknown, right: unknown): SequenceComparison {
  return {
    ...adapterComparison(left, right),
    count: Array.isArray(left) ? left.length : 0,
    preserved: deepEqual(left, right),
  };
}

function generatedDiscoveryQueries(roles: string[]): {
  keywords: string;
  location: string;
}[] {
  return roles.map((role) => ({ keywords: role, location: '' }));
}

function createDatabasePathAudit(
  appDatabaseLocation: unknown,
  runtimeDatabasePath: string,
): DatabasePathAudit {
  const appPath =
    typeof appDatabaseLocation === 'string' ? appDatabaseLocation : null;
  return {
    runtimeJsonPath: normalizePath(runtimeDatabasePath),
    appSettingsPath: appPath === null ? 'absent-or-non-string' : normalizePath(appPath),
    exactValuesMatch: appPath === runtimeDatabasePath,
    normalizedPathsMatch:
      appPath !== null && resolve(appPath) === resolve(runtimeDatabasePath),
    startupSelector:
      process.env['JOB_BROWSER_DB_PATH'] === undefined
        ? 'runtime.json.databasePath'
        : 'JOB_BROWSER_DB_PATH override',
  };
}

function createFixedFixtureComparison(
  oldCandidate: CandidateProfile,
  oldScoring: ScoringConfig,
  newCandidate: CandidateProfile,
  newScoring: ScoringConfig,
) {
  const job = fixedJobFixture();
  const verification = fixedVerificationFixture();
  const oldHash = createScoreInputHash(
    job,
    oldCandidate,
    oldScoring,
    verification,
  );
  const newHash = createScoreInputHash(
    job,
    newCandidate,
    newScoring,
    verification,
  );
  return {
    fixtureId: 'stage0b-fixed-job',
    scoreInputHash: oldHash,
    oldHash,
    newHash,
    equivalent: oldHash === newHash,
  };
}

function fixedJobFixture(): JobForScoring {
  return {
    id: 'stage0b-fixed-job',
    fingerprint: 'stage0b-fixed-fingerprint',
    externalId: 'stage0b-fixed-external',
    title: 'Security Analyst',
    normalizedTitle: 'security analyst',
    company: 'Example Employer',
    normalizedCompany: 'example employer',
    location: 'Example City, EX',
    city: 'Example City',
    state: 'EX',
    remoteType: 'hybrid',
    employmentType: 'full-time',
    salaryMinimum: 60_000,
    salaryMaximum: 80_000,
    salaryText: '$60,000-$80,000',
    description: 'Monitor security events.',
    requirements: 'Security+ certification',
    preferredQualifications: 'SIEM experience',
    postingUrl: 'https://example.invalid/jobs/stage0b-fixed',
    sourceName: 'Stage 0B fixture',
    sourceType: 'fixture',
    datePosted: '2026-07-17T12:00:00.000Z',
    agency: null,
    department: null,
    gradeLow: null,
    gradeHigh: null,
    payPlan: null,
    appointmentType: null,
    workSchedule: null,
    teleworkEligible: null,
    openingDate: null,
    closingDate: null,
    applicationUrls: [],
    firstSeenAt: '2026-07-18T12:00:00.000Z',
    lastSeenAt: '2026-07-18T12:00:00.000Z',
    active: true,
    clearanceRequirement: null,
    sponsorshipAvailable: null,
    estimatedExperienceYears: 2,
    seniorityLevel: 'entry',
    score: 82,
    recommendation: 'recommended',
    scoreExplanation: 'Strong certification and skills match.',
    status: 'new',
  };
}

function fixedVerificationFixture(): VerificationResult {
  return {
    evidence: {
      status: 'verified',
      verifiedAt: '2026-07-18T12:00:00.000Z',
      verificationSource: 'stage0b-fixture',
      httpStatus: 200,
      applicationStatus: null,
      evidence: [],
      closedIndicators: [],
    },
    workArrangement: 'hybrid',
    workArrangementEvidence: [],
    illinoisEligibility: 'eligible',
    illinoisEvidence: [],
    schedule: {
      classification: 'daytime',
      evidence: [],
      riskIndicators: [],
      positiveIndicators: [],
    },
    eligibility: {
      passed: true,
      rejectionReason: 'none',
      rejectionDetail: null,
    },
    extractedRequirements: {
      requiredYears: 2,
      preferredYears: 3,
      degreeRequired: false,
      degreeInProgressOk: true,
      clearancesRequired: [],
      clearancesSponsorable: false,
      travelRequired: false,
      travelPercent: null,
      physicalRequirements: [],
      commissionBased: false,
      developmentFocused: false,
      fieldInstallation: false,
      weekendsRequired: false,
      onCallRequired: false,
      rotatingShifts: false,
      overnightRequired: false,
    },
  };
}

function verifyLegacyRuntimeReadPath(): boolean {
  try {
    const backend = readFileSync(
      resolve(process.cwd(), 'src/server/backend.ts'),
      'utf8',
    );
    const manager = readFileSync(
      resolve(process.cwd(), 'src/desktop/backendManager.ts'),
      'utf8',
    );
    const runtimeSources = [
      'src/server/backend.ts',
      'src/desktop/backendManager.ts',
      'src/server/app.ts',
      'src/desktop/main.ts',
    ].map((path) =>
      readFileSync(resolve(process.cwd(), path), 'utf8').includes(
        'profilePreferences',
      ),
    );
    return (
      backend.includes('loadCandidateProfile(options.candidateProfilePath)') &&
      backend.includes('loadScoringConfig(options.scoringConfigPath)') &&
      manager.includes('candidateProfilePath: paths.candidateProfile') &&
      manager.includes('scoringConfigPath: paths.scoringConfig') &&
      runtimeSources.every((containsNewPath) => !containsNewPath)
    );
  } catch {
    return false;
  }
}

function createReport(
  loaded: {
    legacy: LegacyPreferences;
    databasePathAudit: DatabasePathAudit;
  },
  comparison: ReturnType<typeof buildComparison>,
  document: ReturnType<typeof fromLegacyPreferences>,
  beforeManifest: ProtectedManifest,
  afterManifest: ProtectedManifest,
  runtime: Record<string, unknown>,
  runtimeDatabasePath: string,
) {
  return {
    stage: '0B',
    behavioralChange: false,
    targetFile: 'settings/profile-preferences.json',
    importedSources: [
      'settings/candidate-profile.json',
      'settings/scoring-config.json',
      'database.app_settings.searchProfile',
      'database.app_settings.targetRoles',
    ],
    excludedOperationalSources: [
      'settings/runtime.json',
      'database.app_settings.databaseLocation',
      'database.app_settings.resumeDirectory',
      'database.app_settings.artifactDirectory',
      'database.app_settings.theme',
      'database.discovery_settings.scheduler_enabled',
    ],
    importedFieldCounts: {
      candidate: Object.keys(loaded.legacy.candidateProfile).length,
      jobPreferences: Object.keys(document.jobPreferences).length,
      roleFamilies: loaded.legacy.searchProfile.families.length,
      sourceQueryRoles: loaded.legacy.sourceQueryRoles.length,
      scoring: Object.keys(loaded.legacy.scoringConfig).length,
    },
    equivalence: {
      allDeeplyEquivalent: comparison.allDeeplyEquivalent,
      sectionEquivalence: comparison.sectionEquivalence,
      adapterOutputs: comparison.adapterOutputs,
      ordering: comparison.ordering,
      roleFamilyMatchingInputs: comparison.roleMatching,
      generatedDiscoveryQueryInputs: comparison.ordering.sourceQueries,
    },
    scoreVersionHash: createScoreVersion(
      loaded.legacy.candidateProfile,
      loaded.legacy.scoringConfig,
    ),
    fixedFixture: comparison.fixedFixture,
    databasePathAudit: {
      ...loaded.databasePathAudit,
      runtimeJsonFieldHash: hashValue(runtime),
      runtimeJsonDatabasePathHash: hashValue(runtimeDatabasePath),
      reads: DATABASE_PATH_TRACE.reads,
      writes: DATABASE_PATH_TRACE.writes,
      classification:
        loaded.databasePathAudit.exactValuesMatch ||
        loaded.databasePathAudit.normalizedPathsMatch
          ? 'mirrored-or-equivalent'
          : 'stale-or-inconsistent-operational-setting',
    },
    runtimeReadPath: {
      usesLegacyCandidateProfile: true,
      usesLegacyScoringConfig: true,
      newDocumentWiredIntoRuntime: false,
      verifiedBySourceInspection: comparison.runtimeReadPathVerified,
    },
    integrity: {
      productionDatabaseUnchanged: manifestGroupUnchanged(
        beforeManifest,
        afterManifest,
        'production-database',
      ),
      sqliteWalUnchanged: manifestGroupUnchanged(
        beforeManifest,
        afterManifest,
        'production-database-wal',
      ),
      sqliteShmUnchanged: manifestGroupUnchanged(
        beforeManifest,
        afterManifest,
        'production-database-shm',
      ),
      resumesUnchanged: manifestGroupUnchanged(
        beforeManifest,
        afterManifest,
        'resumes',
      ),
      browserProfilesUnchanged: manifestGroupUnchanged(
        beforeManifest,
        afterManifest,
        'browser-profile',
      ),
      legacySettingsUnchanged: manifestGroupUnchanged(
        beforeManifest,
        afterManifest,
        'settings',
      ),
      allProtectedFilesUnchanged: manifestsEqual(beforeManifest, afterManifest),
    },
  };
}

async function snapshotProtectedFiles(
  root: string,
  databasePath: string,
  targetPath: string,
): Promise<ProtectedManifest> {
  const manifest: ProtectedManifest = {};
  await snapshotSingle(manifest, 'production-database', databasePath);
  await snapshotSingle(
    manifest,
    'production-database-wal',
    `${databasePath}-wal`,
  );
  await snapshotSingle(
    manifest,
    'production-database-shm',
    `${databasePath}-shm`,
  );
  await snapshotDirectory(manifest, 'settings', join(root, 'settings'), [
    targetPath,
  ]);
  await snapshotDirectory(manifest, 'resumes', join(root, 'resumes'));
  for (const directory of BROWSER_PROFILE_DIRECTORIES) {
    await snapshotDirectory(
      manifest,
      `browser-profile/${directory}`,
      join(root, directory),
    );
  }
  return manifest;
}

async function snapshotSingle(
  manifest: ProtectedManifest,
  label: string,
  path: string,
): Promise<void> {
  manifest[label] = await fingerprint(path);
}

async function snapshotDirectory(
  manifest: ProtectedManifest,
  label: string,
  directory: string,
  excludedPaths: string[] = [],
): Promise<void> {
  manifest[`${label}/__root__`] = await fingerprint(directory);
  if (!existsSync(directory)) return;
  for (const path of walkFiles(directory)) {
    if (excludedPaths.some((excluded) => path === excluded)) continue;
    const childLabel = `${label}/${relative(directory, path).replaceAll('\\', '/')}`;
    manifest[childLabel] = await fingerprint(path);
  }
}

function walkFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function fingerprint(path: string): Promise<FileFingerprint> {
  if (!existsSync(path)) return { exists: false, size: null, sha256: null };
  const stats = lstatSync(path);
  if (!stats.isFile()) return { exists: true, size: null, sha256: null };
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: string | Buffer) => hash.update(chunk));
    stream.on('end', () => resolvePromise());
    stream.on('error', reject);
  });
  return { exists: true, size: stats.size, sha256: hash.digest('hex') };
}

function manifestGroupUnchanged(
  before: ProtectedManifest,
  after: ProtectedManifest,
  prefix: string,
): boolean {
  const keys = new Set([
    ...Object.keys(before).filter(
      (key) => key === prefix || key.startsWith(`${prefix}/`),
    ),
    ...Object.keys(after).filter(
      (key) => key === prefix || key.startsWith(`${prefix}/`),
    ),
  ]);
  return [...keys].every((key) => deepEqual(before[key], after[key]));
}

function manifestsEqual(
  before: ProtectedManifest,
  after: ProtectedManifest,
): boolean {
  return deepEqual(before, after);
}

function normalizePath(value: string): string {
  const normalized = resolve(value);
  const root = resolve(userDataPath);
  const relativePath = relative(root, normalized).replaceAll('\\', '/');
  if (
    relativePath === '' ||
    (!relativePath.startsWith('../') && relativePath !== '..')
  )
    return `<userData>/${relativePath}`;
  return '<external-path>';
}

function hashValue(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value)) ?? 'undefined';
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObjectKeys(entry)]),
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  )
    return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        deepEqual(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ),
    )
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
