import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { requireAuth } from '../middleware/auth.middleware';
import type { AuthRequest } from '../middleware/auth.middleware';

const JWT_SECRET = config.JWT_SECRET as string;
const ACCOUNT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF5';

function makeRequest(authorization?: string): AuthRequest {
    return { headers: authorization === undefined ? {} : { authorization } } as AuthRequest;
}

function makeResponse() {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response & { status: jest.Mock; json: jest.Mock };
}

describe('requireAuth middleware', () => {
    let next: jest.Mock;

    beforeEach(() => {
        next = jest.fn();
    });

    it('responds 401 without calling next when the Authorization header is missing', () => {
        const req = makeRequest();
        const res = makeResponse();

        requireAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Missing or invalid Authorization header' });
        expect(next).not.toHaveBeenCalled();
        expect(req.account).toBeUndefined();
    });

    it('responds 401 without calling next when the scheme is not Bearer', () => {
        const res = makeResponse();

        requireAuth(makeRequest('Basic dXNlcjpwYXNz'), res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Missing or invalid Authorization header' });
        expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 without calling next when the token signature is invalid', () => {
        const token = jwt.sign({ sub: ACCOUNT }, 'not-the-real-secret');
        const res = makeResponse();

        requireAuth(makeRequest(`Bearer ${token}`), res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
        expect(next).not.toHaveBeenCalled();
    });

    it('responds 401 without calling next when the token has expired', () => {
        const token = jwt.sign({ sub: ACCOUNT }, JWT_SECRET, { expiresIn: -10 });
        const res = makeResponse();

        requireAuth(makeRequest(`Bearer ${token}`), res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
        expect(next).not.toHaveBeenCalled();
    });

    it('sets req.account from the token sub and calls next exactly once for a valid token', () => {
        const token = jwt.sign({ sub: ACCOUNT }, JWT_SECRET);
        const req = makeRequest(`Bearer ${token}`);
        const res = makeResponse();

        requireAuth(req, res, next);

        expect(req.account).toBe(ACCOUNT);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });
});
