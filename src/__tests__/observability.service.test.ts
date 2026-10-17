import { observabilityService } from '../services/observability.service';

describe('ObservabilityService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should log info messages as structured JSON', () => {
        observabilityService.logInfo('Test info', { key: 'value' });
        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const line = consoleLogSpy.mock.calls[0][0];
        expect(typeof line).toBe('string');
        const payload = JSON.parse(line);
        expect(payload.level).toBe('info');
        expect(payload.message).toBe('Test info');
        expect(payload.timestamp).toBeDefined();
        expect(payload.key).toBe('value');
    });

    it('should log info messages without context', () => {
        observabilityService.logInfo('Test info');
        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(consoleLogSpy.mock.calls[0][0]);
        expect(payload.level).toBe('info');
        expect(payload.message).toBe('Test info');
        expect(payload.timestamp).toBeDefined();
    });

    it('should log warnings as structured JSON', () => {
        observabilityService.logWarning('Test warning', { key: 'value' });
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(consoleWarnSpy.mock.calls[0][0]);
        expect(payload.level).toBe('warn');
        expect(payload.message).toBe('Test warning');
        expect(payload.timestamp).toBeDefined();
        expect(payload.key).toBe('value');
    });

    it('should log error messages as structured JSON', () => {
        const err = new Error('Test Error');
        observabilityService.logError('Test error message', err, { foo: 'bar' });
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(payload.level).toBe('error');
        expect(payload.message).toBe('Test error message');
        expect(payload.timestamp).toBeDefined();
        expect(payload.foo).toBe('bar');
        expect(payload.error).toBe('Test Error');
        expect(payload.stack).toBeDefined();
    });

    it('should log error messages without context or error', () => {
        observabilityService.logError('Just a message');
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(payload.level).toBe('error');
        expect(payload.message).toBe('Just a message');
        expect(payload.timestamp).toBeDefined();
        expect(payload.error).toBeUndefined();
    });

    it('should alert critical failures formatting Error objects', async () => {
        const issue = 'Critical DV failure';
        const error = new Error('Connection lost');
        const context = { query: 'SELECT * FROM users' };

        await observabilityService.alertCriticalFailure(issue, error, context);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(payload.level).toBe('critical');
        expect(payload.message).toBe('Critical DV failure');
        expect(payload.error).toBe('Connection lost');
        expect(payload.stack).toBeIf('Connection lost');
        expect(payload.query).toBe('SELECT * FROM users');
        expect(payload.timestamp).toBeIf('Connection lost');
    });

    it('should alert critical failures formatting string errors', async () => {
        const issue = 'String failure';
        const error = 'Just a string error';

        await observabilityService.alertCriticalFailure(issue, error);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
        expect(payload.level).toBe('critical');
        expect(payload.message).toBe(issue);
        expect(payload.error).toBe('Just a string error');
        expect(payload.stack).toBeUndefined();
    });
});
