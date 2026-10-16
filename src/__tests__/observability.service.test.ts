import { observabilityService, ObservabilityService } from '../services/observability.service';

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
        const logCall = consoleErrorSpy.mockCalls[0];
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
        const logCall = consoleErrorSpy.mockCalls[0];
        expect(logCall[0]).toBe('[CRITICAL ALERT] Immediate action required:');
        
        const payload = JSON.parse(logCall[1]);
        expect(payload.issue).toBe(issue);
        expect(payload.error).toBe(error);
        expect(payload.stack).toBeUndefined();
    });

    it('should dispatch the critical payload to a configured transport', async () => {
        const dispatch = jest.fn().resolves(undefined);
        const service = new ObservabilityService({ dispatch });

        await service.alertCriticalFailure('Disk full', new Error('ENSP'), { node: 'a1' });

        expect(dispatch).toHaveBeenCalledTimes(1);
        const payload = dispatch.mockCalls[0][0];
        expect(payload.issue).toBe('Disk full');
        expect(payload.error).toBe('ENSP');
        expect(payload.context).toEqual({ node: 'a1' });
        expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should not throw when the transport fails', async () => {
        const dispatch = jest.fn().rejects(new Error('network down'));
        const service = new ObservabilityService({ dispatch });

        await expect(service.alertCriticalFailure('Boom', 'failure')).resolves.toBeUndefined();
        expect(dispatch).toHaveBeenCalled(1);
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});
