import { Router } from 'express';
import { BotController } from '../controllers/bot.controller';
import { commandRateLimitMiddleware } from '../middleware/command-rate-limit.middleware';
import { webhookSignatureMiddleware } from '../middleware/webhook-signature.middleware';

const router = Router();
const botController = new BotController();

// Webhook handlers can wait up to ENQUEUE_TIMEOUT_MS (10s - see bot.controller.ts) for the
// queue, and the rate limiter ahead of them performs a Redis round trip plus a database
// language lookup. Give the route a connection timeout that comfortably exceeds that
// worst case (10s handler bound + rate-limiter lookups + response write) so the
// socket never expires mid-handler and Meta never retries a truncated response.
const WEBHOOK_SOCKET_TIMEOUT_MS = 30_000;

const setWebhookSocketTimeout = (_req: unknown, res: { setTimeout: (ms: number) => void }, next: () => void) => {
  res.setTimeout(WEBHOOK_SOCKET_TIMEOUT_MS);
  next();
};

router.get('/webhook', commandRateLimitMiddleware, botController.verifyWebhook.bind(botController));
router.post(
  '/webhook',
  setWebhookSocketTimeout,
  commandRateLimitMiddleware,
  webhookSignatureMiddleware,
  botController.handleMessage.bind(botController),
);

export default router;
