import { Request, Response, NextFunction } from 'express';
import jpwt from 'jsonwebtoken';
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
        const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: [config.JWT_ALGORITHM]}) as { sub: string };
        req.account = decoded.sub;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};
