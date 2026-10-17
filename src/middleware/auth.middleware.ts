import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface AuthRequest extends Request {
    account?: string;
    scope?: string;
}

export interface AuthPayload {
    sub: string;
    iss?: string;
    aud?: string | string[];
    scope?: string;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET, {
            issuer: config.JWT_ISSUER,
            audience: config.JWT_AUDIENCE,
        }) as AuthPayload;

        if (!decoded.iss || decoded.iss !== config.JWT_ISSUER) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        const aud = decoded.aud;
        const audiValid = Array.isArray(aud)
            ? aud.includes(config.JWT_AUDIENCE)
            : aud === config.JWT_AUDIENCE;
        if (!audiValid) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        if (!decoded.sub) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        req.account = decoded.sub;
        req.scope = decoded.scope;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
