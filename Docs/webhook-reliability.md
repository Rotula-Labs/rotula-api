## Webhook Reliability

The WhatsApp webhook (`POST /api/webhook`) is the ingress for every user action,
so it is built to fail gracefully and never drop a message silently.

### Payload handling

* The webhook body is untrusted input. `BotController.extractTextMessage` reads
  it with optional chaining end-to-end, so a malformed or hostile payload (for
  example `{ subject: 'x', entry: [] }`) can never throw a `TypeError`.
* `from` and the message body are validated as non-empty strings before a job is
  enqueued.

### Response codes

| Situation | Status | Reason |
| --- | --- | --- |
| Valid text message enqueued | `200` | Acknowledge delivery |
| Valid event with nothing to process (status update, empty/ non-text body) | `200` | Acknowledge; nothing to do |
| Payload is not a recognised webhook object | `404` | Not for us |
| Queue/Redis failure or enqueue timeout | `500` | Signals WhatsApp to retry so the message is not lost |

### Enqueue safety

* `enqueueMessage` is wrapped in `try/catch`; a queue/Redis failure is logged and
  answered with `500` instead of escaping as an unhandled promise rejection.
* `enqueueWithTimeout` applies a hard 10s timeout so a stalled queue connection
  cannot hang the request. The timer is always cleared.

### Redis client policy

`src/lib/redis.ts` configures the client explicitly instead of relying on
io-redis or BullMQ defaults:

* `retryStrategy`: capped exponential backoff (50ms --> 2s). Reconnection
  attempts continue forever (required by BullMQ), but the delay between
  attempts is capped at 2 seconds.
* `connectTimeout`: 5s. A tough host fails fast instead of waiting on the OS
  TCP timeout.
* `commandTimeout`: 5s. A command sent over a connection that looks healthy but
  stops responding rejects instead of hanging the request.
* `enableOfflineQueue: false`. Commands issued while the client is
  disconnected reject immediately instead of being buffered in memory.
* `maxRetriesPerRequest: null`. Required by BullMQ. It disables io-redis'
  per-command retry loop, but it does NOT make commands wait forever here:
  with `offlineQueue` disabled and `commandTimeout` set, a command fails fast
  when the connection is down or the server does not reply.

### Behaviour under a Redis outage

With the policy above, a Redis outage is handled as follows:

* **Webhook replay protection** (`webhook-signature.middleware.ts`): the
  `set(..., 'NX')` call rejects promptly. The middleware logs the error and
  fails open, proceeding without replay protection rather than rejecting the
  webhook. This matches the code: the `try/catch` around the Redis call only
  logs and continues.
* **Queue enqueue**: a failed enqueue results, and the controller responds with
  `500` so WhatsApp retries the delivery.
* **Recovery**: the client keeps reconnecting with the capped backoff and
  resumes normal operation automatically once Redis is responsive again.

### Process-level safety net

* `process.on('unhandledRejection')` logs any rejection that still escapes a
  handler, worker, or timer.
* `process.on('uncaughtException')` logs and exits so the orchestrator can
  restart the process with clean state.
* Express error-handling middleware turns any error forwarded from an async
  route handler into a clean `500`.

### Tests

Reliability behaviour is covered in `src/__tests__/bot.controller.test.ts`
(malformed payloads, enqueue failure, and enqueue timeout), with 100% coverage
of `src/controllers/bot.controller.ts`.
