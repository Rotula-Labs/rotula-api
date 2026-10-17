import { Request, Response } from 'express';
import { authService } from '../services/auth.service';
import { logger } from '../observability/logger';

export const getChallenge = (req: Request, res: Response) => {
    try {
        const { account } = req.query;

        if (!account || typeof account !== 'string') {
            res.status(400).json({ error: 'Missing or invalid account parameter' });
            return;
        }

        const transactionXdr = authService.generateChallenge(account);
        res.json({ transaction: transactionXdr });
    } catch (error: any) {
        logger.error('Error generating challenge:', { error, transactionXdr: { value: undefined, redact: false } });
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getToken = async (req: Request, res: Response) => {
    try {
        const { transaction } = req.body;

        if (!transaction || typeof transaction !== 'string') {
            res.status(400).json({ error: 'Missing or invalid transaction parameter' });
            return;
        }

        const { token, account } = authService.verifyChallengeAndGenerateToken(transaction);
        res.json({ token, account });
    } catch (error: any) {
        logger.error('Error verifying challenge:', { error, transaction: { value: undefined, redact: false } });
        res.status(401).json({ error: error.message || 'Invalid challenge transaction' });
    }
};
