import { Request, Response, NextFunction } from 'express';
const jwt = require('jsonwebtoken');
import { config } from '../config/env';

export interface AuthRequest extends Request {
    account?: string;
}

export const requireAuth = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);

        if (typeof decoded !== 'object' || decoded === null) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        const sub = (decoded as Record<string, unknown>).sub;

        if (typeof sub !== 'string' || sub.length === 0) {
            res.status(401).json({ error: 'Invalid or expired token' });
            return;
        }

        req.account = sub;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
