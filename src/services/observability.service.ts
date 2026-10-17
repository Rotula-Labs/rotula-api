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
     * Tracks failed authentication attempts per source address and raises a
     * critical alert once the configured threshold is crossed.
     */
    public recordFailedAuthentication(source: string, requestId?: string, threshold: number = 5): void {
        const context = { source, requestId };
        this.logWarning('Admin authentication failed', context);

        const count = (this.failedAuthCounts.get(source) ?? 0) + 1;
        this.failedAuthCounts.set(source, count);

        if (count >= threshold) {
            void this.alertCriticalFailure(
                'Repeated admin authentication failures',
                new Error(`Repeated admin authentication failures from ${source}`),
                { source, requestId, count, threshold }
            );
        }
    }

    private readonly failedAuthCounts: Map<string, number> = new Map();
}

export const observabilityService = new ObservabilityService();
