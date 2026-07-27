import type { NextFunction, Request, Response } from 'express';

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

export function enforceLoopbackRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const host = request.headers.host ?? '';
  if (!LOOPBACK_HOST.test(host)) {
    response.status(403).json({ error: 'Only loopback requests are allowed' });
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin !== undefined) {
      try {
        const parsed = new URL(origin);
        if (!LOOPBACK_HOST.test(parsed.host)) {
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
