import { observabilityService } from '../services/observability.service';
import { config } from '../config/env';

const ISO_TIMESTAMP = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/;

describe('ObservabilityService', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;
    const originalLogLevel = (config as any).LOG_LEVEL;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        (config as any).LOG_LEVEL = 'info';
    });

    afterEach(() => {
        jest.restoreAllMocks();
        (config as any).LOG_LEVEL = originalLogLevel;
    });

    it('should log info messages with a timestamp and level', () => {
        observabilityService.logInfo('Test info', { key: 'value' });
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringMatching(ISO_TIMESTAMP),
            '[INFO] Test info',
            '{"key":"value"}'
        );
        const line = consoleLogSpy.mock.calls[0][0] as string;
        expect(line).match(ISO_TIMESTAMP);
        expect(line).contain('[INFO]');
    });

    it('should log info messages without context', () => {
        observabilityService.logInfo('Test info');
        expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringMatching(ISO_TIMESTAMP),
            '[INFO] Test info',
            ''
        );
    });

    it('should log warning messages', () => {
        observabilityService.logWarning('Test warning', { a: 1 });
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringMatching(ISO_TIMESTAMP),
            '[WARN] Test warning',
            '{"a":1}'
        );
    });

    it('should log error messages', () => {
        const err = new Error('Test Error');
        observabilityService.logError('Test error message', err, { foo: 'bar' });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringMatching(ISO_TIMESTAMP),
            '[ERROR] Test error message',
            err,
            '{"foo":"bar"}'
        );
    });

    it('should log error messages without context or error', () => {
        observabilityService.logError('Just a message');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringMatching(ISO_TIMESTAMP),
            '[ERROR] Just a message',
            undefined,
            ''
        );
    });

    it('should suppress info and warn when configured at error level', () => {
        (config as any).LOG_LEVEL = 'error';
        observabilityService.logInfo('hidden info');
        observabilityService.logWarning('hidden warn');
        observabilityService.logError('shown error');
        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should suppress info when configured at warn level', () => {
        (config as any).LOG_LEVEL = 'warn';
        observabilityService.logInfo('hidden info');
        observabilityService.logWarning('shown warn');
        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    });

    it('should alert critical failures formatting Error objects', async () => {
        const issue = 'Critical DB failure';
        const error = new Error('Connection lost');
        const context = { query: 'SELECT * FROM users' };

        await observabilityService.alertCriticalFailure(issue, error, context);

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const logCall = consoleErrorSpy.mock.calls[0];
        const line = logCall[0] as string;
        expect(line).match(ISO_TIMESTAMP);
        expect(line).contain('[CRITICAL ALERT] Immediate action required:');

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
        const line = logCall[0] as string;
        expect(line).match(ISO_TIMESTAMP);
        expect(line).contain('[CRITICAL ALERT] Immediate action required:');

        const payload = JSON.parse(logCall[1]);
        expect(payload.issue).toBe(issue);
        expect(payload.error).toBe(error);
        expect(payload.stack).toBeUndefined();
    });

    it('should never suppress the critical alert', async () => {
        (config as any).LOG_LEVEL = 'error';
        await observabilityService.alertCriticalFailure('Boom', new Error('boom'));
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
});
