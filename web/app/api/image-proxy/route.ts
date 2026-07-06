import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { flagGuard } from '@/lib/flags';
import {
  IMAGE_PROXY_MAX_BYTES,
  IMAGE_PROXY_TIMEOUT_MS,
  isImageContentType,
  validateProxyUrl,
} from '@/lib/image-proxy';

/**
 * GET /api/image-proxy?url=<encoded-url>
 *
 * Server-side image proxy (plan 028, task 3). Fetches an external image on
 * behalf of the browser so HTML documents with external `<img>` tags can
 * render without the reader's browser making outbound requests.
 *
 * Gated behind `FEATURE_IMAGE_PROXY` (off by default). When disabled, the
 * vault-links transform strips external images entirely (existing behavior).
 *
 * Security:
 *   - SSRF protection: rejects private/loopback IPs, localhost, .local, .internal
 *   - Content-Type validation: response must start with `image/`
 *   - Size cap: 5MB max (IMAGE_PROXY_MAX_BYTES)
 *   - Timeout: 5s (IMAGE_PROXY_TIMEOUT_MS)
 *   - No redirects to internal targets (fetch follows redirects, but the
 *     Content-Type check on the final response catches non-image responses)
 */
export async function GET(req: NextRequest) {
  const blocked = flagGuard('imageProxy');
  if (blocked) return blocked;

  const url = req.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ detail: 'Missing "url" query parameter' }, { status: 400 });
  }

  const validationError = validateProxyUrl(url);
  if (validationError) {
    return NextResponse.json({ detail: validationError }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'image/*' },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { detail: `Upstream returned ${response.status}` },
        { status: 502 },
      );
    }

    const contentType = response.headers.get('content-type');
    if (!isImageContentType(contentType)) {
      return NextResponse.json(
        { detail: `Upstream Content-Type is not an image: ${contentType}` },
        { status: 502 },
      );
    }

    // Read the body with a size cap
    const reader = response.body?.getReader();
    if (!reader) {
      return NextResponse.json({ detail: 'No response body' }, { status: 502 });
    }

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > IMAGE_PROXY_MAX_BYTES) {
        reader.cancel();
        return NextResponse.json(
          { detail: `Image exceeds size limit (${IMAGE_PROXY_MAX_BYTES} bytes)` },
          { status: 502 },
        );
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType ?? 'image/png',
        'Content-Length': String(totalBytes),
        'Cache-Control': 'public, max-age=86400, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('abort')) {
      return NextResponse.json({ detail: 'Upstream request timed out' }, { status: 502 });
    }
    return NextResponse.json({ detail: `Fetch failed: ${message}` }, { status: 502 });
  }
}
