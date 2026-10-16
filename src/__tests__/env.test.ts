jest.mock('dotenv', () => ({
    __esModule: true,
    default: { config: jest.fn() },
}));

describe('webhook verification token configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it.each([undefined, ''])('rejects a missing or empty VERIFY_TOKEN (%s) at startup', (token) => {
        if (token === undefined) {
            delete process.env.VERIFY_TOKEN;
        } else {
            process.env.VERIFY_TOKEN = token;
        }

        expect(() => {
            jest.isolateModules(() => {
                require('../config/env');
            });
        }).toThrow('VERIFY_TOKEN environment variable is required');
    });

    it('uses the configured token without changing its value', () => {
        process.env.VERIFY_TOKEN = 'configured-test-token';

        jest.isolateModules(() => {
            const { config } = require('../config/env');

            expect(config.VERIFY_TOKEN).toBe('configured-test-token');
        });
    });
});
