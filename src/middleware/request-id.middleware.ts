import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const REQUEST_ID_HEADER = 'X-Request-Id';

export interface RequestWithId extends Request {
    requestId?: string;
}

/**
 * Attaches an identity to every request so that log lines and
 * associated WhatsApp messages can be traced back to a single request.
 *
 * Reads an inbound `X-Request-Id` header when present and otherwise
 * generates a UUID. The id is stored on `req.requestId` and `res.locals`,
 * and echoed back as a response header.
 */
export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const provided = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = typeof provided === 'string' && provided.trim() !== ''
        ? provided.trim()
        : randomUUID();

    req.requestId = requestId;
    res.locals.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
}

export default requestIdMiddleware;
