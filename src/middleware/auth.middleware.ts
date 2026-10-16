import { Request, Response, NextFunction } from 'express';

import jwt from 'jsonwebtoken';
import { config } from '../config/env';

export interface AuthRequest extends Request {
    account?: string;
    authenticatedAdmin?: string;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET) as { sub: string; admin?: string; role?: string; label?: string };
        req.account = decoded.sub;
        const adminIdentity = decoded.admin || decoded.label || (decoded.role === 'admin' ? decoded.sub : undefined);
        if (adminIdentity) {
            req.authenticatedAdmin = adminIdentity;
        }
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
