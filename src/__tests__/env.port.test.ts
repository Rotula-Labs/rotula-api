jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('PORT configuration at startup', () => {
    const originalPort = process.env.PORT;

    afterEach(() => {
        if (originalPort === undefined) {
            delete process.env.PORT;
        } else {
            process.env.PORT = originalPort;
        }
    });

    function loadPort(): number {
        let port = 0;
        jest.isolateModules(() => {
            port = require('../config/env').config.PORT;
        });
        return port;
    }

    it('defaults to numeric port 3000 when PORT is unset', () => {
        delete process.env.PORT;

        expect(loadPort()).toBe(3000);
    });

    it.each(['1', '3000', '8080', '65535', '03000'])('parses %s as a numeric TCP port', (value) => {
        process.env.PORT = value;

        expect(loadPort()).toBe(Number(value));
    });

    it.each([
        '', ' ', '3000 ', ' 3000', '3000\n', 'placeholder', '/tmp/rotula.sock',
        'http://0.0.0.0:3000', '3000abc', '3.5', '3e3', '0xBB8', '+3000',
        '-1', '0', '65536', '999999999999999999999', 'NaN', 'Infinity',
    ])('rejects invalid PORT %j before startup completes', (value) => {
        process.env.PORT = value;

        expect(loadPort).toThrow('PORT must be an integer between 1 and 65535');
    });
});
