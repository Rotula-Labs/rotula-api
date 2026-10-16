import * as StellarSdk from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';

// Mock the external services
jest.mock('../lib/redis', () => ({
    redisClient: {
        set: jest.fn().mockResolvedValue('OK'),
    }
}));

jest.mock('@stellar/stellar-sdk', () => {
    const original = jest.requireActual('@stellar/stellar-sdk');
    return {
        ...original,
        Horizon: {
            Server: jest.fn().mockImplementation(() => ({
                loadAccount: jest.fn().mockImplementation((accountId) => {
                    // We can use a global flag or specific account IDs, but since we generate random ones
                    // let's just check a global variable set in the test
                    const weight = (global as any).mockZeroWeight ? 0 : 1;
                    return Promise.resolve({
                        signers: [{ key: accountId, weight: weight, type: 'ed25519_public_key' }],
                        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 }
                    });
                })
            }))
        }
    };
});

jest.mock('../queue/key-rotation.queue', () => ({
    keyRotationQueue: {
        add: jest.fn().mockResolvedValue(undefined),
    },
}));

import { authService } from '../services/auth.service';
import { redisClient } from '../lib/redis';

describe('Auth Service - SEP-10', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should generate and verify a challenge successfully', async () => {
        // 1. Client keypair
        const clientKeypair = StellarSdk.Keypair.random();
        
        // 2. Generate challenge
        const challengeXdr = authService.generateChallenge(clientKeypair.publicKey());
        
        expect(challengeXdr).toBeDefined();
        
        // 3. Client signs the challenge
        const networkPassphrase = config.STELLAR_NETWORK === 'TESTNET' ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
        const transaction = new StellarSdk.Transaction(challengeXdr, networkPassphrase);
        transaction.sign(clientKeypair);
        const signedXdr = transaction.toEnvelope().toXDR('base64');
        
        // 4. Verify challenge
        const { token, account } = await authService.verifyChallengeAndGenerateToken(signedXdr);
        
        expect(account).toBe(clientKeypair.publicKey());
        expect(token).toBeDefined();
        
        // 5. Verify token manually
        const decoded = jwt.verify(token, config.JWT_SECRET as string) as any;
        expect(decoded.sub).toBe(clientKeypair.publicKey());
    });

    it('should reject a replayed challenge transaction', async () => {
        const clientKeypair = StellarSdk.Keypair.random();
        const challengeXdr = authService.generateChallenge(clientKeypair.publicKey());
        const networkPassphrase = config.STELLAR_NETWORK === 'TESTNET' ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
        const transaction = new StellarSdk.Transaction(challengeXdr, networkPassphrase);
        transaction.sign(clientKeypair);
        const signedXdr = transaction.toEnvelope().toXDR('base64');

        // First call succeeds
        await authService.verifyChallengeAndGenerateToken(signedXdr);

        // Mock redis to return null indicating the key is already set
        (redisClient.set as jest.Mock).mockResolvedValueOnce(null);

        // Second call should fail
        await expect(authService.verifyChallengeAndGenerateToken(signedXdr)).rejects.toThrow('Challenge transaction has already been consumed');
    });

    it('should reject a challenge if the client signature does not meet the threshold', async () => {
        const clientKeypair = StellarSdk.Keypair.random();
        const challengeXdr = authService.generateChallenge(clientKeypair.publicKey());
        const networkPassphrase = config.STELLAR_NETWORK === 'TESTNET' ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
        
        // Sign with a different key (threshold not met)
        const wrongKeypair = StellarSdk.Keypair.random();
        const transaction = new StellarSdk.Transaction(challengeXdr, networkPassphrase);
        transaction.sign(wrongKeypair);
        const signedXdr = transaction.toEnvelope().toXDR('base64');

        await expect(authService.verifyChallengeAndGenerateToken(signedXdr)).rejects.toThrow();
    });

    it('should reject a challenge if the master key has zero weight and no other signers meet the threshold', async () => {
        (global as any).mockZeroWeight = true;
        
        const clientKeypair = StellarSdk.Keypair.random();
        const challengeXdr = authService.generateChallenge(clientKeypair.publicKey());
        const networkPassphrase = config.STELLAR_NETWORK === 'TESTNET' ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;
        const transaction = new StellarSdk.Transaction(challengeXdr, networkPassphrase);
        transaction.sign(clientKeypair);
        const signedXdr = transaction.toEnvelope().toXDR('base64');

        await expect(authService.verifyChallengeAndGenerateToken(signedXdr)).rejects.toThrow();

        (global as any).mockZeroWeight = false;
    });
});

describe('Admin routes - token gate', () => {
    const originalAdminToken = process.env.ADMIN_TOKEN;
    let request: any;
    let app: any;

    beforeAll(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        request = require('supertest');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const adminRouter = require('../routes/admin.routes').default;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const express = require('express');
        app = express();
        app.use(express.json());
        app.use('/admin', adminRouter);
    });

    afterEach(() => {
        if (originalAdminToken === undefined) {
            delete process.env.ADMIN_TOKEN;
        } else {
            process.env.ADMIN_TOKEN = originalAdminToken;
        }
    });

    it('returns 401 when no Authorization header is provided', async () => {
        process.env.ADMIN_TOKEN = 'secret-token';
        const res = await request(app).get('/admin/anything');
        expect(res.status).toBe(401);
    });

    it('returns 401 when a wrong token is provided', async () => {
        process.env.ADMIN_TOKEN = 'secret-token';
        const res = await request(app)
            .get('/admin/anything')
            .set('Authorization', 'Bearer wrong-token');
        expect(res.status).toBe(401);
    });

    it('passes the gate when the correct token is provided', async () => {
        process.env.ADMIN_TOKEN = 'secret-token';
        const res = await request(app)
            .get('/admin/anything')
            .set('Authorization', `Bearer ${process.env.ADMIN_TOKEN}`);
        expect(res.status).not.toBe(401);
    });

    it('returns 401 when ADMIN_TOKEN is unset and Bearer undefined is supplied', async () => {
        delete process.env.ADMIN_TOKEN;
        const res = await request(app)
            .get('/admin/anything')
            .set('Authorization', 'Bearer undefined');
        expect(res.status).toBe(401);
    });
});
