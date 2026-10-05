import type { NextFunction, Request, Response } from 'express';

const ALLOWED_HOST =
  /^(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\]|(?:[a-z0-9-]+\.)*run\.app)(?::\d+)?$/i;

export function enforceLoopbackRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const host = request.headers.host ?? '';
  if (!ALLOWED_HOST.test(host)) {
    response.status(403).json({ error: 'Only loopback requests are allowed' });
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin !== undefined) {
      try {
        const parsed = new URL(origin);
        if (
          !ALLOWED_HOST.test(parsed.host) &&
          parsed.host.toLowerCase() !== host.toLowerCase()
        ) {
          response
            .status(403)
            .json({ error: 'Cross-origin requests are not allowed' });
          return;
        }
      } catch {
        response.status(403).json({ error: 'Invalid request origin' });
        return;
      }
    }
  }
  next();
}
