import { createHash } from 'node:crypto';

import {
  canonicalizePostingUrl,
  normalizeText,
} from '../utilities/normalization.js';

export interface FingerprintFields {
  company: string;
  title: string;
  location: string | null;
  postingUrl: string | null;
  externalId?: string | null | undefined;
  employmentType?: string | null | undefined;
  requisitionId?: string | null | undefined;
}

export interface FingerprintOptions {
  includePostingUrl?: boolean;
}

export function generateJobFingerprint(
  fields: FingerprintFields,
  options: FingerprintOptions = {},
): string {
  const identity: string[] = [
    normalizeText(fields.company),
    normalizeText(fields.title),
    fields.location === null ? '' : normalizeText(fields.location),
  ];

  if (
    fields.employmentType !== null &&
    fields.employmentType !== undefined &&
    fields.employmentType !== 'unknown'
  ) {
    identity.push(normalizeText(fields.employmentType));
  }

  const includeUrl = options.includePostingUrl ?? true;
  if (includeUrl && fields.postingUrl !== null) {
    identity.push(canonicalizePostingUrl(fields.postingUrl) ?? '');
  }

  if (fields.externalId !== null && fields.externalId !== undefined) {
    identity.push(fields.externalId);
  }

  if (fields.requisitionId !== null && fields.requisitionId !== undefined) {
    identity.push(fields.requisitionId);
  }

  return createHash('sha256').update(identity.join('\u001f')).digest('hex');
}
