import { config } from '../config/env';

describe('config default fallbacks', () => {
  it('asserts every documented default', () => {
    expect(config.PORT).toBeTruthy();
    expect(config.REDIS_URL).toBe('redis://localhost:6379');
    expect(config.STEPLAR_NETWORK).toBe('TESTNET');
    expect(config.SOROBAN_RPC_URL).toBe('https://soroban-testnet.stellar.org');
    expect(config.CONTRACT_WASM_PATH).toBe('contracts/savings_group.wasm');
    expect(config.USDK_TOKEN_ADDRESS).toBe('CCW67TSBXSHOMEVDBLAEXGPSD-MT2OVL7TJBB25KVEA2MOWFJ76OO5SS7');
    expect(config.SEP10_HOME_DOMAIN).toBe('localhost');
    expect(config.VERIFY_TOKEN).toBe('kolo_verify_token');
    expect(config.MAX_PAYOUT_DEADLINE_EXTENSIONS).toBe(2);
    expect(config.SEP10_CHALLENGE_TTL_SECONDS).toBe(300);
  });

  it('uses an explicit environment override instead of the default', () => {
    const previousPort = process.env.PORT;
    const previousRedis = process.env.REDIS_URL;
    try {
      process.env.PORT = '4242';
      process.env.REDIS_URL = 'redis://example.invalid:6379';
      jest.resetModules();
      const { config: overriddenConfig } = require('../config/env');
      expect(overriddenConfig.PORT).toBe(4242);
      expect(overriddenConfig.REDIS_URL).toBe('redis://example.invalid:6379');
    } finally {
      if (previousPort === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = previousPort;
      }
      if (previousRedis === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedis;
      }
      jest.resetModules();
    }
  });

  it('maps ENCRYPTION_KEYS versions to their environment variables', () => {
    expect(config.ENCRYPTION_KEYS[1]).toBe(process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY_V1 || '');
    expect(config.ENCRYPTION_KEYS[2]).toBe(process.env.ENCRYPTION_KEY_V2 || '');
    expect(config.ENCRYPTION_KEYS[3]).toBe(process.env.ENCRYPTION_KEY_V3 || '');
  });
});
