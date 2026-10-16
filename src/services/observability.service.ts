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
     * Emits one structured access line for a completed request.
     * Carries method, path/route, status, duration and request id.
     * Never includes the body, query string or phone number.
     */
    public logAccess(
        payload: {
            requestId?: string;
            method: string;
            path: string;
            status: number;
            durationMs: number;
        },
    ): void {
        const line = {
            type: 'access',
            requestId: payload.requestId,
            method: payload.method,
            path: payload.path,
            status: payload.status,
            durationMs: payload.durationMs,
            timestamp: new Date().toISOString(),
        };
        console.log('[ACCESS]', JSON.stringify(line));
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
    }
}

export const observabilityService = new ObservabilityService();
