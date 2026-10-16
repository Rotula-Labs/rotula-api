import { type ErrorRequestHandler } from 'express';

export interface BodyParserError extends Error {
    type?: string;
    status?: number;
    statusCode?: number;
    expose?: boolean;
}

/**
 * Middleware that translates body-parser failures into client error
 * responses. A malformed JSON body is a 400 and an oversized body is a
 * 413 — neither is a server fault, so neither should page anyone.
 */
export const parserErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const parserErr = err as BodyParserError;

    if (parserErr && parserErr.type === 'entity.too.large') {
        if (res.headersSent) {
            return next(err);
        }
        res.status(413).json({ error: 'Payload too large' });
        return;
    }

    if (parserErr && (parserErr.type === 'entity.parse.failed' || parserErr instanceof SyntaxError)) {
        if (res.headersSent) {
            return next(err);
        }
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
    }

    return next(err);
};
