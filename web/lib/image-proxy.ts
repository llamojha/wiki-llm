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

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '[::1]') return true;
  // fc00::/7 — unique local addresses
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // fe80::/10 — link-local
  if (lower.startsWith('fe80')) return true;
  // IPv4-mapped ::ffff:x.x.x.x
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);
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

  // Check for direct IP addresses
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) return `Private IP: ${hostname}`;
  } else if (hostname.includes(':') || /^\[?[0-9a-f:]+\]?$/i.test(hostname)) {
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
 */
export function isImageContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return contentType.trim().toLowerCase().startsWith('image/');
}
