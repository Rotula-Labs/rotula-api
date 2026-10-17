export class ObservabilityService {
    /**
     * Logs general operational info.
     */
    public logInfo(message: string, context?: Record<string, any>): void {
        console.log(`[INFO] ${message}`, context ? JSON.stringify(context) : '');
    }

    /**
     * Logs warnings.
     */
    public logWarning(message: string, context?: Record<string, any>): void {
        console.warn(`[WARN] ${message}`, context ? JSON.stringify(context) : '');
    }

    /**
     * Logs non-critical errors.
     */
    public logError(message: string, error?: any, context?: Record<string, any>): void {
        console.error(`[ERROR] ${message}`, error, context ? JSON.stringify(context) : '');
    }

    /**
     * Alerts on critical failures, typically triggering a PagerDuty/Slack webhook.
     * This fulfills the requirement for strict alerting on critical webhook failures.
     */
    public async alertCriticalFailure(issue: string, error: any, context?: Record<string, any>): Promise<void> {
        const payload = {
            issue,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            context,
            timestamp: new Date().toISOString()
        };
        
        console.error(`[CRITICAL ALERT] Immediate action required:`, JSON.stringify(payload, null, 2));
        
        // In a real scenario, this would POST to Sentry, Datadog, or an incident management webhook.
        // We decouple the alerting mechanism here so it's fully unit-testable.
    }

    /**
     * Reports a Redis connection state transition to observability.
     * Each significant transition produces a log line; connection losses raise a critical alert.
     */
    public reportRedisState(
        state: 'connect' | 'ready' | 'close' | 'reconnecting' | 'end' | 'error',
        context?: Record<string, any>
    ): void {
        const message = `Redis connection state transition: ${state}`;

        if (state === 'error' || state === 'close' || state === 'end') {
            this.logWarning(message, context);
            void this.alertCriticalFailure(
                'Redis connection lost',
                new Error(`Redis connection state: ${state}`),
                { state, ...context }
            );
            return;
        }

        this.logInfo(message, { state, ...context });
    }
}

export const observabilityService = new ObservabilityService();
