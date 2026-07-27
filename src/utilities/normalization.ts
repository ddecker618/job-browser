const TRACKING_PARAMETERS = new Set([
  'fbclid',
  'gclid',
  'source',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

export function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

export function normalizeLocation(value: string | null): string | null {
  return value === null ? null : normalizeText(value);
}

export function canonicalizePostingUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const url = new URL(value);
  url.hash = '';
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  for (const parameter of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.has(parameter.toLowerCase())) {
      url.searchParams.delete(parameter);
    }
  }

  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  url.searchParams.sort();
  return url.toString();
}
