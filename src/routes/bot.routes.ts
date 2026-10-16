import { Router } from 'express';
import { BotController } from '../controllers/bot.controller';
import { commandRateLimitMiddleware } from '../middleware/command-rate-limit.middleware';
import { webhookSignatureMiddleware } from '../middleware/webhook-signature.middleware';
import { addressRateLimitMiddleware } from '../middleware/address-rate-limit.middleware';

const router = Router();
const botController = new BotController();

router.get('/webhook', commandRateLimitMiddleware, botController.verifyWebhook.bind(botController));
router.post('/webhook', addressRateLimitMiddleware, webhookSignatureMiddleware, commandRateLimitMiddleware, botController.handleMessage.bind(botController));

export default router;
