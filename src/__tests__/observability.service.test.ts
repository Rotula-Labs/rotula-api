import { observabilityService } from '../services/observability.service';

describe('ObservabilityService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should log info messages', () => {
        observabilityService.logInfo('Test info', { key: 'value' });
        expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] Test info', '{"key":"value"}');
    });

    it('should log info messages without context', () => {
        observabilityService.logInfo('Test info');
        expect(consoleLogSpy).toHaveBeenCalledWith('[INFO] Test info', '');
    });

    it('should log error messages', () => {
        const err = new Error('Test Error');
        observabilityService.logError('Test error message', err, { foo: 'bar' });
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] Test error message', err, '{"foo":"bar"}');
    });

    it('should log error messages without context or error', () => {
        observabilityService.logError('Just a message');
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ERROR] Just a message', undefined, '');
    });

    it('should alert critical failures formatting Error objects', async () => {
        const issue = 'Critical DB failure';
        const error = new Error('Connection lost');
        const context = { query: 'SELECT * FROM users' };

        await observabilityService.alertCriticalFailure(issue, error, context);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const logCall = consoleErrorSpy.mock.calls[0];
        expect(logCall[0]).toBe('[CRITICAL ALERT] Immediate action required:');
        
        const payload = JSON.parse(logCall[1]);
        expect(payload.issue).toBe(issue);
        expect(payload.error).toBe('Connection lost');
        expect(payload.stack).toBeDefined();
        expect(payload.context).toEqual(context);
        expect(payload.timestamp).toBeDefined();
    });

    it('should alert critical failures formatting string errors', async () => {
        const issue = 'String failure';
        const error = 'Just a string error';

        await observabilityService.alertCriticalFailure(issue, error);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const logCall = consoleErrorSpy.mock.calls[0];
        expect(logCall[0]).toBe('[CRITICAL ALERT] Immediate action required:');
        
        const payload = JSON.parse(logCall[1]);
        expect(payload.issue).toBe(issue);
        expect(payload.error).toBe(error);
        expect(payload.stack).toBeUndefined();
    });

    it('should log a stuctured access line for a request', () => {
        observabilityService.logAccess({ requestId: 'req-123', method: 'GET', path: '/webhook', status: 200, durationMs: 12.3 });
        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const logCall = consoleLogSpy.mock.calls[0];
        expect(logCall[0]).toBe('[ACCESS]');
        const payload = JSON.parse(logCall[1]);
        expect(payload.requestId).toBe('req-123');
        expect(payload.method).toBe('GET');
        expect(payload.path).toBe('/webhook');
        expect(payload.status).toBe(200);
        expect(payload.durationMs).toBeDefined();
    });

    it('should not include a body or phone number in the access line', () => {
        observabilityService.logAccess({ requestId: 'req-456', method: 'POST', path: '/webhook', status: 403, durationMs: 3.1 });
        const logCall = consoleLogSpy.mock.calls[0];
        const line = logCall[0] + logCall[1];
        expect(line).not.toMatch(/\+/);
        expect(line).not.toMatch(/body/i);
    });
});
