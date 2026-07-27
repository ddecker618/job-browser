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
}

export interface FingerprintOptions {
  includePostingUrl?: boolean;
}

export function generateJobFingerprint(
  fields: FingerprintFields,
  options: FingerprintOptions = {},
): string {
  const identity = [
    normalizeText(fields.company),
    normalizeText(fields.title),
    fields.location === null ? '' : normalizeText(fields.location),
  ];

  if (options.includePostingUrl === true) {
    identity.push(canonicalizePostingUrl(fields.postingUrl) ?? '');
  }

  return createHash('sha256').update(identity.join('\u001f')).digest('hex');
}
