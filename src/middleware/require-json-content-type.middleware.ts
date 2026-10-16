import { type Request, type Response, type NextFunction } from 'express';

/**
 * Requires a JSON Content-Type on requests that carry a JSON body.
 *
 * With only `express.json()` mounted, a POST sent as `text/plain` arrives with
 * `req.body` as `{}`, so controllers report a missing parameter instead of
 * telling the caller their payload was never read. This guard answers 415
 * with a JSON envelope instead.
 *
 * The webhook route is left to the signature middleware, which already reads
 * the raw body.
 */
export function requireJsonContentTypeMiddleware(req: Request, res: Response, next: NextFunction): void {
    const contentType = req.headers['content-type'];
    const mediaType = contentType?.split(';')[0].trim().toLowerCase();

    if (mediaType !== 'application/json') {
        res.status(415).json({
            error: 'Unsupported Media Type',
            message: 'Content-Type must be application/json',
        });
        return;
    }

    next();
}
