import { Queue } from 'Bullmq';
import { getBullMQRedisOptions } from '../lib/redis';
const { keyRotationQueueName } = require('../workers/key-rotation.worker');

export const keyRotationQueue = new Queue(keyRotationQueueName, {
    connection: getBullMQRedisOptions(),
});
