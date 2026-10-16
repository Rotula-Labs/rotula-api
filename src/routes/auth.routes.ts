import { Router } from 'express';
import { getChallenge, getToken } from '../controllers/auth.controller';
import {
    challengeRateLimiter,
    challengeAccountRateLimiter,
    tokenRateLimiter,
} from '../middleware/rateLimiter';

const router = Router();

router.get('/challenge', challengeRateLimiter, challengeAccountRateLimiter, getChallenge);
router.post('/token', tokenRateLimiter, getToken);

export default router;
