import { Router } from 'express';
import { getChallenge, getToken } from '../controllers/auth.controller';
import { requireJsonContentTypeMiddleware } from '../middleware/require-json-content-type.middleware';

const router = Router();

router.get('/challenge', getChallenge);
router.post('/token', requireJsonContentTypeMiddleware, getToken);

export default router;
