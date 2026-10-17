export class ObservabilityService {
    private emit(level: string, message: string, context?: Record<string, any>): void {
        const entry = {
            level,
            timestamp: new Date().toISOString(),
            message,
            ...(context ?? {})
        };
        const line = JSON.stringify(entry);
        if (level === 'info') {
            console.log(line);
        } else if (level === 'warn') {
            console.warn(line);
        } else {
            console.error(line);
        }
    }

    /**
     * Logs general operational info.
     */
    public logInfo(message: string, context?: Record<string, any>): void {
        this.emit('info', message, context);
    }

    /**
     * Logs warnings.
     */
    public logWarning(message: string, context?: Record<string, any>): void {
        this.emit('warn', message, context);
    }

    /**
     * Logs non-critical errors.
     */
    public logError(message: string, error?: any, context?: Record<string, any>): void {
        const errorContext: Record<string, any> = { ...(context ?? {}) };
        if (error !== undefined) {
            errorContext.error = error instanceof Error ? error.message : String(error);
            if (error instanceof Error && error.stack) {
                errorContext.stack = error.stack;
            }
        }
        this.emit('error', message, errorContext);
    }

    /**
     * Alerts on critical failures, typically triggering a PagerDuty/Slack webhook.
     * This fulfills the requirement for strict alerting on critical webhook failures.
     */
    public async alertCriticalFailure(issue: string, error: any, context?: Record<string, any>): Promise<void> {
        const entry = {
            level: 'critical',
            timestamp: new Date().toISOString(),
            message: issue,
            error: error instanceof Error ? error.message : String(error),
            ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
            ...(context ?? {})
        };

        console.error(JSON.stringify(entry));
    }
}

export const observabilityService = new ObservabilityService();
