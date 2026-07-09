/**
 * Image proxy helpers — SSRF protection and validation (plan 028, task 3).
 *
 * This module is deliberately free of `next/server` so it stays unit-testable.
 * The route handler (`/api/image-proxy`) imports from here.
 */

/** Maximum response body size the proxy will buffer (5MB). */
export const IMAGE_PROXY_MAX_BYTES = 5 * 1024 * 1024;

/** Fetch timeout in milliseconds. */
export const IMAGE_PROXY_TIMEOUT_MS = 5_000;

/** Maximum number of redirects the proxy will follow (validating each hop). */
export const IMAGE_PROXY_MAX_REDIRECTS = 5;

/**
 * IPv4 ranges that must never be fetched — private, loopback, link-local,
 * and metadata services.
 */
const PRIVATE_IPV4_RANGES: Array<{ base: number; mask: number }> = [
  { base: ipv4ToNum('127.0.0.0'), mask: 0xff000000 },     // 127.0.0.0/8 (loopback)
  { base: ipv4ToNum('10.0.0.0'), mask: 0xff000000 },      // 10.0.0.0/8
  { base: ipv4ToNum('172.16.0.0'), mask: 0xfff00000 },    // 172.16.0.0/12
  { base: ipv4ToNum('192.168.0.0'), mask: 0xffff0000 },   // 192.168.0.0/16
  { base: ipv4ToNum('169.254.0.0'), mask: 0xffff0000 },   // 169.254.0.0/16 (link-local / IMDS)
  { base: ipv4ToNum('100.64.0.0'), mask: 0xffc00000 },    // 100.64.0.0/10 (CGNAT / cloud-internal)
  { base: ipv4ToNum('0.0.0.0'), mask: 0xff000000 },       // 0.0.0.0/8
];

function ipv4ToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const num = ipv4ToNum(ip);
  return PRIVATE_IPV4_RANGES.some((r) => (num & r.mask) === (r.base & r.mask));
}

/**
 * Expand a full IPv6 address (colon-hex) to 8 groups of 4 hex digits.
 * Handles `::` zero-compression. Returns null if the input isn't valid IPv6.
 */
function expandIPv6(ip: string): number[] | null {
  const stripped = ip.replace(/^\[|\]$/g, '');
  const halves = stripped.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (s: string): number[] =>
    s ? s.split(':').map((g) => parseInt(g, 16)) : [];

  const left = parseGroups(halves[0]);
  const right = halves.length === 2 ? parseGroups(halves[1]) : [];
  const missing = 8 - left.length - right.length;

  if (halves.length === 2 && missing < 0) return null;
  if (halves.length === 1 && left.length !== 8) return null;

  const groups = [...left, ...Array(Math.max(0, missing)).fill(0), ...right];
  if (groups.length !== 8) return null;
  if (groups.some((g) => isNaN(g) || g < 0 || g > 0xffff)) return null;
  return groups;
}

/**
 * Extract the embedded IPv4 address from an IPv4-mapped IPv6 address.
 * Handles both dotted form (::ffff:127.0.0.1) and hex form (::ffff:7f00:1).
 * Returns the IPv4 as a dotted string, or null if not IPv4-mapped.
 */
function extractMappedIPv4(ip: string): string | null {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');

  // Dotted notation: ::ffff:192.168.1.1
  const dottedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMatch) return dottedMatch[1];

  // Hex notation: expand and check prefix is 0:0:0:0:0:ffff
  const groups = expandIPv6(lower);
  if (!groups) return null;
  if (
    groups[0] === 0 && groups[1] === 0 && groups[2] === 0 &&
    groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff
  ) {
    const hi = groups[6];
    const lo = groups[7];
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');

  // Loopback ::1
  if (lower === '::1') return true;

  // Unspecified ::
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;

  // fc00::/7 — unique local addresses
  const groups = expandIPv6(lower);
  if (groups) {
    const firstByte = (groups[0] >> 8) & 0xff;
    // fc00::/7 = first byte 0xfc or 0xfd
    if (firstByte === 0xfc || firstByte === 0xfd) return true;
    // fe80::/10 — link-local (first 10 bits = 1111 1110 10)
    if ((groups[0] & 0xffc0) === 0xfe80) return true;
  }

  // IPv4-mapped ::ffff:x.x.x.x (both dotted and hex forms)
  const mappedV4 = extractMappedIPv4(lower);
  if (mappedV4) return isPrivateIPv4(mappedV4);

  return false;
}

/**
 * Validate a URL for the image proxy. Returns an error string if the URL is
 * not safe to fetch, or `null` if it's acceptable.
 */
export function validateProxyUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return 'Invalid URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Disallowed protocol: ${parsed.protocol}`;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  // Check for direct IPv4 addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) return `Private IP: ${hostname}`;
  } else if (hostname.includes(':') || /^\[?[0-9a-f:]+\]?$/i.test(hostname)) {
    // IPv6 literal (with or without brackets)
    if (isPrivateIPv6(hostname)) return `Private IP: ${hostname}`;
  } else {
    // Hostname-based checks — block `localhost` and common internal hostnames
    const lower = hostname.toLowerCase();
    if (
      lower === 'localhost' ||
      lower.endsWith('.local') ||
      lower.endsWith('.internal')
    ) {
      return `Disallowed hostname: ${hostname}`;
    }
  }

  return null;
}

/**
 * Validate that a Content-Type header looks like an image type.
 * Rejects `image/svg+xml` because SVG can contain scripts that execute
 * with same-origin access when served from the proxy.
 */
export function isImageContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.trim().toLowerCase();
  if (normalized.startsWith('image/svg')) return false;
  return normalized.startsWith('image/');
}

/**
 * Resolve a hostname to IP addresses and validate that none are private.
 * Returns an error string if the hostname resolves to a blocked address,
 * or `null` if safe. Uses Node.js `dns.promises.lookup` with `all: true`
 * to check every A/AAAA record.
 */
export async function validateResolvedHost(hostname: string): Promise<string | null> {
  // Skip validation for IP literals — already checked by validateProxyUrl.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  if (hostname.includes(':') || /^\[?[0-9a-f:]+\]?$/i.test(hostname)) return null;

  const { lookup } = await import('node:dns/promises');
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return `DNS resolution failed for ${hostname}`;
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      return `Hostname ${hostname} resolves to private IP: ${address}`;
    }
    if (family === 6 && isPrivateIPv6(address)) {
      return `Hostname ${hostname} resolves to private IP: ${address}`;
    }
  }

  return null;
}
