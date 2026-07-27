import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export interface ResolvedPublicUrl {
  url: URL;
  addresses: { address: string; family: 4 | 6 }[];
}

export type PublicDnsLookup = (
  hostname: string,
) => Promise<readonly { address: string; family: number }[]>;

export class PublicUrlPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PublicUrlPolicyError';
  }
}

export function validatePublicUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicUrlPolicyError('URL is invalid');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new PublicUrlPolicyError('URL must use HTTP or HTTPS');
  }
  if (url.username !== '' || url.password !== '') {
    throw new PublicUrlPolicyError('URL credentials are not allowed');
  }
  if (url.hostname === '')
    throw new PublicUrlPolicyError('URL host is required');

  const hostname = stripIpv6Brackets(url.hostname).toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new PublicUrlPolicyError('URL host is not public');
  }
  if (isIP(hostname) !== 0 && !isPublicIpAddress(hostname)) {
    throw new PublicUrlPolicyError('URL host is not public');
  }
  return url;
}

export async function resolvePublicUrl(
  value: string | URL,
  lookup: PublicDnsLookup = defaultLookup,
): Promise<ResolvedPublicUrl> {
  const url = validatePublicUrl(value);
  const hostname = stripIpv6Brackets(url.hostname);
  if (isIP(hostname) !== 0) {
    return {
      url,
      addresses: [{ address: hostname, family: isIP(hostname) as 4 | 6 }],
    };
  }

  let records: readonly { address: string; family: number }[];
  try {
    records = await lookup(hostname);
  } catch {
    throw new PublicUrlPolicyError('URL host could not be resolved');
  }
  if (records.length === 0) {
    throw new PublicUrlPolicyError('URL host could not be resolved');
  }
  if (
    records.some(
      ({ address, family }) =>
        (family !== 4 && family !== 6) || !isPublicIpAddress(address),
    )
  ) {
    throw new PublicUrlPolicyError('URL host resolved to a non-public address');
  }
  return {
    url,
    addresses: records.map(({ address, family }) => ({
      address,
      family: family as 4 | 6,
    })),
  };
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const bytes = parseIpv6(address);
  if (bytes === null) return false;
  const compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (compatible) return isPublicIpv4(bytes.slice(12).join('.'));
  const mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (mapped) {
    return isPublicIpv4(bytes.slice(12).join('.'));
  }

  if (bytes.every((byte) => byte === 0)) return false; // unspecified
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1)
    return false; // loopback
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return false; // unique-local fc00::/7
  if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return false; // link-local
  if (bytes[0] === 0xff) return false; // multicast
  if (
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  )
    return false; // documentation
  return true;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(address: string): number[] | null {
  const bare = address.split('%', 1)[0] ?? '';
  const sides = bare.split('::');
  if (sides.length > 2) return null;
  const left = parseIpv6Side(sides[0] ?? '');
  const right = parseIpv6Side(sides[1] ?? '');
  if (left === null || right === null) return null;
  const missing = 8 - left.length - right.length;
  if (
    (sides.length === 1 && missing !== 0) ||
    (sides.length === 2 && missing < 1)
  )
    return null;
  return [...left, ...Array<number>(missing).fill(0), ...right].flatMap(
    (part) => [part >> 8, part & 0xff],
  );
}

function parseIpv6Side(side: string): number[] | null {
  if (side === '') return [];
  const output: number[] = [];
  for (const part of side.split(':')) {
    if (part.includes('.')) {
      const octets = part.split('.').map(Number);
      if (
        octets.length !== 4 ||
        octets.some(
          (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
        )
      )
        return null;
      output.push(
        (octets[0] ?? 0) * 256 + (octets[1] ?? 0),
        (octets[2] ?? 0) * 256 + (octets[3] ?? 0),
      );
    } else {
      if (!/^[\da-f]{1,4}$/i.test(part)) return null;
      output.push(Number.parseInt(part, 16));
    }
  }
  return output;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

async function defaultLookup(
  hostname: string,
): Promise<readonly { address: string; family: number }[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}
