export interface AlertPayload {
    issue: string;
    error: string;
    stack?: string;
    context?: Record<string, any>;
    timestamp: string;
}

export interface AlertTransport {
    dispatch(payload: AlertPayload): Promise<void>;
}

export class ConsoleAlertTransport implements AlertTransport {
    public async dispatch(payload: AlertPayload): Promise<void> {
        console.error(`[CRITICAL ALERT] Immediate action required:`, JSON.stringify(payload, null, 2));
    }
}

export class WebhookAlertTransport implements AlertTransport {
    constructor(private readonly endpoint: string) {}

    public async dispatch(payload: AlertPayload): Promise<void> {
        const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error(`Alert webhook responded with status ${response.status}`);
        }
    }
}

export class ObservabilityService {
    private readonly transport: AlertTransport;
    private readonly fallbackTransport: AlertTransport;

    constructor(transport?: AlertTransport) {
        this.fallbackTransport = new ConsoleAlertTransport();
        const endpoint = process.env.ALERT_WEBHOOK_URL;
        this.transport = transport || (endpoint ? new WebhookAlertTransport(endpoint) : this.fallbackTransport);
    }

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
        const payload: AlertPayload = {
            issue,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            context,
            timestamp: new Date().toISOString()
        };

        try {
            await this.transport.dispatch(payload);
        } catch (transportError) {
            // A transport failure must not throw into the caller. Fall back to the
            // console so the critical payload still leaves evidence.
            try {
                await this.fallbackTransport.dispatch(payload);
            } catch {
                // Nothing more we can do here; never throw into the caller.
            }
            console.error(`[CRITICAL ALERT] Transport dispatch failed:`, transportError);
        }
    }
}

export const observabilityService = new ObservabilityService();
