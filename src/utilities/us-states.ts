// Deterministic U.S. state normalization shared by location consumers.
//
// Full state names map to their two-letter postal codes; two-letter inputs are
// accepted as-is (uppercased). This is intentionally conservative: anything
// that is not a recognizable state form is left null so no downstream consumer
// invents a location.

export const US_STATE_BY_NAME: Record<string, string> = {
  alabama: 'al',
  alaska: 'ak',
  arizona: 'az',
  arkansas: 'ar',
  california: 'ca',
  colorado: 'co',
  connecticut: 'ct',
  delaware: 'de',
  florida: 'fl',
  georgia: 'ga',
  hawaii: 'hi',
  idaho: 'id',
  illinois: 'il',
  indiana: 'in',
  iowa: 'ia',
  kansas: 'ks',
  kentucky: 'ky',
  louisiana: 'la',
  maine: 'me',
  maryland: 'md',
  massachusetts: 'ma',
  michigan: 'mi',
  minnesota: 'mn',
  mississippi: 'ms',
  missouri: 'mo',
  montana: 'mt',
  nebraska: 'ne',
  nevada: 'nv',
  'new hampshire': 'nh',
  'new jersey': 'nj',
  'new mexico': 'nm',
  'new york': 'ny',
  'north carolina': 'nc',
  'north dakota': 'nd',
  ohio: 'oh',
  oklahoma: 'ok',
  oregon: 'or',
  pennsylvania: 'pa',
  'rhode island': 'ri',
  'south carolina': 'sc',
  'south dakota': 'sd',
  tennessee: 'tn',
  texas: 'tx',
  utah: 'ut',
  vermont: 'vt',
  virginia: 'va',
  washington: 'wa',
  'west virginia': 'wv',
  wisconsin: 'wi',
  wyoming: 'wy',
};

const TWO_LETTER_STATE = /^[A-Za-z]{2}$/;

/**
 * Normalizes a full state name or two-letter code to an uppercase postal code.
 * Returns null for anything that is not a recognizable state form.
 */
export function normalizeStateCode(value: string): string | null {
  const trimmed = value.trim();
  if (TWO_LETTER_STATE.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const code = US_STATE_BY_NAME[trimmed.toLowerCase()];
  return code === undefined ? null : code.toUpperCase();
}

/**
 * Parses a free-form location string into a city and a normalized state code.
 *
 * Handles "City, ST", "City, State Name", and a bare state name. Remote
 * locations carry no city or state.
 */
export function parseLocationCityState(location: string): {
  city: string | null;
  state: string | null;
} {
  if (/remote/i.test(location)) return { city: null, state: null };

  const commaMatch = /^\s*([^,]+?)\s*,\s*(.+?)\s*$/.exec(location);
  if (commaMatch?.[1] && commaMatch[2]) {
    const city = commaMatch[1].trim();
    const state = normalizeStateCode(commaMatch[2]);
    if (state !== null) {
      return { city, state };
    }
  }

  const stateOnly = normalizeStateCode(location);
  if (stateOnly !== null) {
    return { city: null, state: stateOnly };
  }

  return { city: null, state: null };
}
