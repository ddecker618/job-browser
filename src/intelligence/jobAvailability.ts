import { boundedPublicFetch } from '../security/boundedPublicFetch.js';
import { nowUtc } from '../utilities/timestamps.js';
import { verifyPosting } from './verificationService.js';

export interface JobAvailabilityOutcome {
  available: boolean;
  statusCode: number | null;
  reason: 'alive' | 'closed' | 'unreachable';
  verifiedAt: string;
}

export type AvailabilityFetcher = (
  postingUrl: string,
) => Promise<{ status: number; text: string }>;

const defaultFetcher: AvailabilityFetcher = async (postingUrl) => {
  const response = await boundedPublicFetch(postingUrl, {
    timeoutMs: 15_000,
    maxBytes: 1_000_000,
  });
  return { status: response.status, text: response.text() };
};

/**
 * Fetches a public posting and determines whether it is still live.
 *
 * A posting is considered unavailable when the fetched page is definitively
 * closed (verifyPosting detected closed indicators) or the fetch fails network-
 * style. A missing postingUrl is unverifiable and treated as alive so jobs from
 * providers without a URL are never spuriously killed.
 */
export async function verifyJobAvailability(
  postingUrl: string | null,
  fetchPosting: AvailabilityFetcher = defaultFetcher,
): Promise<JobAvailabilityOutcome> {
  const verifiedAt = nowUtc();
  if (postingUrl === null || postingUrl.length === 0) {
    return { available: true, statusCode: 200, reason: 'alive', verifiedAt };
  }
  try {
    const response = await fetchPosting(postingUrl);
    const verification = verifyPosting(response.text, postingUrl, response.status);
    const available = verification.evidence.status !== 'closed';
    return {
      available,
      statusCode: response.status,
      reason: available ? 'alive' : 'closed',
      verifiedAt,
    };
  } catch {
    return { available: false, statusCode: null, reason: 'unreachable', verifiedAt };
  }
}