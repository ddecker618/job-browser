import type { JobForScoring } from '../domain/job.js';
import type { CandidateProfile } from '../schemas/candidate-profile.js';
import { US_STATE_BY_NAME } from '../utilities/us-states.js';

export type LocationStatus =
  | 'eligible'
  | 'likely_eligible'
  | 'unknown'
  | 'likely_ineligible'
  | 'ineligible';

interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface CommuteResult {
  status: 'within' | 'outside' | 'unknown';
  locationStatus: LocationStatus;
  commuteStatus: 'not_applicable' | 'within' | 'outside' | 'unknown' | 'likely_eligible';
  distanceMiles: number | null;
  evidence: string;
}

const STATE_ALIASES: Record<string, string> = US_STATE_BY_NAME;

// This small local atlas covers the candidate's commuting region and common
// nearby posting locations without sending job locations to a geocoder.
const CITY_COORDINATES: Record<string, Coordinates> = {
  'highland|il': { latitude: 38.7392, longitude: -89.6712 },
  'st louis|mo': { latitude: 38.627, longitude: -90.1994 },
  'saint louis|mo': { latitude: 38.627, longitude: -90.1994 },
  'st charles|mo': { latitude: 38.7881, longitude: -90.4974 },
  'columbia|mo': { latitude: 38.9517, longitude: -92.3341 },
  'ofallon|il': { latitude: 38.5923, longitude: -89.9112 },
  'o fallon|il': { latitude: 38.5923, longitude: -89.9112 },
  'belleville|il': { latitude: 38.5201, longitude: -89.9839 },
  'edwardsville|il': { latitude: 38.8114, longitude: -89.9532 },
  'collinsville|il': { latitude: 38.6703, longitude: -89.984 },
  'fairview heights|il': { latitude: 38.5889, longitude: -89.9901 },
  'troy|il': { latitude: 38.7292, longitude: -89.8834 },
  'maryville|il': { latitude: 38.7273, longitude: -89.9554 },
  'shiloh|il': { latitude: 38.5614, longitude: -89.8973 },
  'scott air force base|il': { latitude: 38.545, longitude: -89.85 },
};

export function classifyCommute(
  job: Pick<JobForScoring, 'city' | 'state' | 'location'>,
  profile: CandidateProfile,
): CommuteResult {
  const jobCity = normalizeCity(job.city);
  const jobState = normalizeState(job.state);
  if (jobCity === null && jobState === null) {
    return {
      status: 'unknown',
      locationStatus: 'unknown',
      commuteStatus: 'not_applicable',
      distanceMiles: null,
      evidence: 'Job has no city/state location; commute does not apply.',
    };
  }
  if (jobCity === null || jobState === null) {
    return {
      status: 'unknown',
      locationStatus: 'unknown',
      commuteStatus: 'unknown',
      distanceMiles: null,
      evidence:
        'Job location is not specific enough to calculate commuting distance.',
    };
  }

  const distances = profile.preferredLocations
    .map((location) => {
      const preferredCity = normalizeCity(location.city);
      const preferredState = normalizeState(location.state);
      if (preferredCity === null || preferredState === null) return null;
      if (preferredCity === jobCity && preferredState === jobState) return 0;
      const jobCoordinates = coordinatesFor(jobCity, jobState);
      const preferredCoordinates = coordinatesFor(
        preferredCity,
        preferredState,
      );
      if (jobCoordinates === null || preferredCoordinates === null) return null;
      return haversineMiles(jobCoordinates, preferredCoordinates);
    })
    .filter((distance): distance is number => distance !== null);

  if (distances.length === 0) {
    const preferredStates = profile.preferredLocations
      .map((location) => normalizeState(location.state))
      .filter((state): state is string => state !== null);
    if (preferredStates.length > 0 && !preferredStates.includes(jobState)) {
      return {
        status: 'outside',
        locationStatus: 'ineligible',
        commuteStatus: 'outside',
        distanceMiles: null,
        evidence: `Job is in ${jobState.toUpperCase()}, outside the configured commuting region.`,
      };
    }
    // Same state but no coordinates available — likely eligible but unconfirmed
    if (preferredStates.length > 0 && preferredStates.includes(jobState)) {
      return {
        status: 'unknown',
        locationStatus: 'likely_eligible',
        commuteStatus: 'likely_eligible',
        distanceMiles: null,
        evidence: `Job is in ${jobState.toUpperCase()} (same state as preferred location) but exact coordinates are unavailable.`,
      };
    }
    return {
      status: 'unknown',
      locationStatus: 'unknown',
      commuteStatus: 'unknown',
      distanceMiles: null,
      evidence: 'No local coordinates are available for this job location.',
    };
  }

  const distanceMiles = Math.round(Math.min(...distances) * 10) / 10;
  const status =
    distanceMiles <= profile.searchRadiusMiles ? 'within' : 'outside';
  const locationStatus: LocationStatus =
    distanceMiles <= profile.searchRadiusMiles ? 'eligible' : 'ineligible';
  const commuteStatus = status === 'within' ? 'within' : 'outside';
  return {
    status,
    locationStatus,
    commuteStatus,
    distanceMiles,
    evidence:
      status === 'within'
        ? `${String(distanceMiles)} miles from a preferred location; within the ${String(profile.searchRadiusMiles)}-mile radius.`
        : `${String(distanceMiles)} miles from the nearest preferred location; outside the ${String(profile.searchRadiusMiles)}-mile radius.`,
  };
}

function normalizeCity(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  return value
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeState(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const normalized = value.toLowerCase().trim();
  return (
    STATE_ALIASES[normalized] ?? (normalized.length === 2 ? normalized : null)
  );
}

function coordinatesFor(city: string, state: string): Coordinates | null {
  return CITY_COORDINATES[`${city}|${state}`] ?? null;
}

function haversineMiles(left: Coordinates, right: Coordinates): number {
  const earthRadiusMiles = 3958.8;
  const latitude = toRadians(right.latitude - left.latitude);
  const longitude = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const value =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(leftLatitude) *
      Math.cos(rightLatitude) *
      Math.sin(longitude / 2) ** 2;
  return (
    earthRadiusMiles * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  );
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export {
  CITY_COORDINATES,
  coordinatesFor,
  haversineMiles,
  normalizeCity,
  normalizeState,
};
