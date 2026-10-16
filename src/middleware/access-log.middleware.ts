import { type NextFunction, type Request, type Response } from 'express';

import { observabilityService } from '../services/observability.service';

/**
 * Express middleware that emits exactly one structured access line per request,
 * on completion. The line carries the HTTP method, the route path (or route
 * pattern), the response status, the duration in milliseconds and the request
 * id. The body, the query string and the phone number are never included.
 */
export function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e7;
        // Prefer the matched route pattern so path params like a phone number do not
        // end up in the log; fall back to the raw path without the query string.
        const routePath = (req.route && req.route.path) || req.path || 'unknown';
        const requestId = (req as any).requestId || req.get('x-request-id') || undefined;

        observabilityService.logAccess(req.method, routePath, res.statusCode, durationMs, requestId);
    });

    next();
}

export default accessLogMiddleware;
