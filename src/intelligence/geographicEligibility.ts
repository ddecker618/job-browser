import type { JobForScoring, RemoteType } from '../domain/job.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import { parseLocationCityState } from '../utilities/us-states.js';
import {
  coordinatesFor,
  haversineMiles,
  normalizeCity,
  normalizeState,
} from './locationEligibility.js';

// ---------------------------------------------------------------------------
// Deterministic geographic eligibility.
//
// Physical worksite distance matters only when the candidate must attend the
// worksite (onsite or hybrid). Remote roles ignore worksite distance unless the
// posting carries an explicit geographic restriction (handled in the
// verification pass). Uncertainty is never treated as positive evidence:
//
//   exact deterministic distance when the local atlas has both coordinates,
//   otherwise configured state-level eligibility,
//   otherwise explicitly UNKNOWN.
//
// No runtime network geocoder and no fabricated mileage from strings.
// ---------------------------------------------------------------------------

export interface GeographicWorksite {
  city: string | null;
  state: string | null;
}

export type WorksiteStatus =
  | 'within'
  | 'outside'
  | 'same-state'
  | 'out-of-state'
  | 'unknown';

export type GeographicLocationKnowledge =
  | 'known_local'
  | 'known_distant'
  | 'known_state_eligible'
  | 'known_state_ineligible'
  | 'unknown';

export interface GeographicEligibility {
  worksites: GeographicWorksite[];
  statuses: WorksiteStatus[];
  knowledge: GeographicLocationKnowledge;
  distanceMiles: number | null;
  hasEligibleWorksite: boolean;
  hasIneligibleWorksite: boolean;
  evidence: string[];
}

export interface GeographicGateResult {
  block: boolean;
  reason: 'location_outside_radius' | null;
  explanation: string | null;
}

export type RecommendationCap = 'none' | 'strong';

const MULTI_LOCATION_SEPARATOR = /[;/]|\band\b|\bor\b/i;
const CITY_STATE_PAIR = /([^,;]+?)\s*,\s*([A-Za-z]{2})(?=\s*(?:[,;]|$))/g;

export function analyzeGeographicEligibility(
  job: Pick<JobForScoring, 'city' | 'state' | 'location'>,
  profile: CandidateProfile,
): GeographicEligibility {
  const worksites = parseWorksites(job);
  const evaluated = worksites.map((worksite) => ({
    worksite,
    ...evaluateWorksite(worksite, profile),
  }));
  const statuses = evaluated.map((entry) => entry.status);

  const hasWithin = statuses.includes('within');
  const hasSameState = statuses.includes('same-state');
  const hasOutside = statuses.some(
    (status) => status === 'outside' || status === 'out-of-state',
  );
  const allKnownOutside =
    worksites.length > 0 &&
    evaluated.every(
      (entry) => entry.status === 'outside' || entry.status === 'out-of-state',
    );

  const exactDistances = evaluated
    .map((entry) => entry.distanceMiles)
    .filter((distance): distance is number => distance !== null);
  const distanceMiles =
    exactDistances.length === 0
      ? null
      : Math.round(Math.min(...exactDistances) * 10) / 10;

  let knowledge: GeographicLocationKnowledge;
  if (hasWithin) {
    knowledge = 'known_local';
  } else if (allKnownOutside) {
    knowledge =
      exactDistances.length > 0 ? 'known_distant' : 'known_state_ineligible';
  } else if (hasSameState) {
    knowledge = 'known_state_eligible';
  } else {
    knowledge = 'unknown';
  }

  const evidence =
    worksites.length === 0
      ? ['Job lists no physical worksite location.']
      : evaluated.map((entry) => worksiteEvidence(entry.worksite, entry.status));

  return {
    worksites,
    statuses,
    knowledge,
    distanceMiles,
    hasEligibleWorksite: hasWithin || hasSameState,
    hasIneligibleWorksite: hasOutside,
    evidence,
  };
}

export function evaluateGeographicGate(
  arrangement: RemoteType,
  geo: GeographicEligibility,
): GeographicGateResult {
  if (arrangement === 'remote') {
    return {
      block: false,
      reason: null,
      explanation: 'Remote role; physical office distance does not apply.',
    };
  }
  if (geo.hasEligibleWorksite) {
    return { block: false, reason: null, explanation: null };
  }
  const everyWorksiteOutside =
    geo.worksites.length > 0 &&
    geo.worksites.every(
      (_worksite, index) =>
        geo.statuses[index] === 'outside' ||
        geo.statuses[index] === 'out-of-state',
    );
  if (everyWorksiteOutside) {
    const explanation =
      arrangement === 'onsite'
        ? 'Onsite role is outside the configured commute boundary.'
        : arrangement === 'hybrid'
          ? 'Hybrid role requires attendance outside the configured commute boundary.'
          : 'Work arrangement is unknown; the listed worksite is outside the configured commute boundary.';
    return { block: true, reason: 'location_outside_radius', explanation };
  }
  return { block: false, reason: null, explanation: null };
}

export function recommendationCapFor(
  arrangement: RemoteType,
  geo: GeographicEligibility,
): RecommendationCap {
  if (arrangement === 'remote') return 'none';
  if (arrangement !== 'unknown' && geo.knowledge === 'known_local') return 'none';
  return 'strong';
}

function parseWorksites(
  job: Pick<JobForScoring, 'city' | 'state' | 'location'>,
): GeographicWorksite[] {
  const worksites: GeographicWorksite[] = [];
  const add = (city: string | null, state: string | null): void => {
    if (city === null && state === null) return;
    const trimmedCity = city === null ? null : city.trim();
    const trimmedState = state === null ? null : state.trim().toUpperCase();
    if (
      !worksites.some(
        (worksite) =>
          worksite.city === trimmedCity && worksite.state === trimmedState,
      )
    ) {
      worksites.push({ city: trimmedCity, state: trimmedState });
    }
  };

  if (job.city !== null || job.state !== null) add(job.city, job.state);

  const location = job.location;
  if (
    location !== null &&
    location.trim() !== '' &&
    !/^remote$/i.test(location.trim())
  ) {
    for (const segment of location.split(MULTI_LOCATION_SEPARATOR)) {
      const trimmed = segment.trim();
      if (trimmed === '') continue;
      const parsed = parseLocationCityState(trimmed);
      if (parsed.city !== null || parsed.state !== null) {
        add(parsed.city, parsed.state);
        continue;
      }
      let match: RegExpExecArray | null;
      while ((match = CITY_STATE_PAIR.exec(trimmed)) !== null) {
        const city = match[1];
        const state = match[2];
        if (city === undefined || state === undefined) continue;
        if (/^remote$/i.test(city.trim())) continue;
        add(city.trim(), state.toUpperCase());
      }
    }
  }

  return worksites;
}

function evaluateWorksite(
  worksite: GeographicWorksite,
  profile: CandidateProfile,
): { status: WorksiteStatus; distanceMiles: number | null } {
  const jobCity = normalizeCity(worksite.city);
  const jobState = normalizeState(worksite.state);
  if (jobCity === null && jobState === null) {
    return { status: 'unknown', distanceMiles: null };
  }
  if (jobState === null) {
    return { status: 'unknown', distanceMiles: null };
  }

  const preferredStates = profile.preferredLocations
    .map((location) => normalizeState(location.state))
    .filter((state): state is string => state !== null);

  if (jobCity !== null) {
    const jobCoordinates = coordinatesFor(jobCity, jobState);
    if (jobCoordinates !== null) {
      let minDistance: number | null = null;
      for (const location of profile.preferredLocations) {
        const preferredCity = normalizeCity(location.city);
        const preferredState = normalizeState(location.state);
        if (preferredCity === null || preferredState === null) continue;
        const preferredCoordinates = coordinatesFor(
          preferredCity,
          preferredState,
        );
        if (preferredCoordinates === null) continue;
        const distance = haversineMiles(jobCoordinates, preferredCoordinates);
        if (minDistance === null || distance < minDistance) {
          minDistance = distance;
        }
      }
      if (minDistance !== null) {
        const distanceMiles = Math.round(minDistance * 10) / 10;
        return {
          status:
            distanceMiles <= profile.searchRadiusMiles ? 'within' : 'outside',
          distanceMiles,
        };
      }
    }
  }

  if (preferredStates.length > 0 && !preferredStates.includes(jobState)) {
    return { status: 'out-of-state', distanceMiles: null };
  }
  if (preferredStates.length > 0 && preferredStates.includes(jobState)) {
    return { status: 'same-state', distanceMiles: null };
  }
  return { status: 'unknown', distanceMiles: null };
}

function worksiteEvidence(
  worksite: GeographicWorksite,
  status: WorksiteStatus,
): string {
  const label =
    worksite.city === null
      ? `Worksite in ${worksite.state ?? 'an unknown location'}`
      : [worksite.city, worksite.state]
          .filter(Boolean)
          .join(', ');
  switch (status) {
    case 'within':
      return `${label}: within the configured commute boundary.`;
    case 'outside':
      return `${label}: outside the configured commute boundary.`;
    case 'same-state':
      return `${label}: in a preferred state; exact distance is unavailable.`;
    case 'out-of-state':
      return `${label}: outside the configured commuting region.`;
    default:
      return `${label}: location is not specific enough to evaluate.`;
  }
}
