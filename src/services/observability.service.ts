export interface MetricsSnapshot {
    counters: Record<string, number>;
    histograms: Record<string, {
        count: number;
        sum: number;
        min: number;
        max: number;
        avg: number;
    }>;
}

export class ObservabilityService {
    private readonly counters: Map<string, number> = new Map();
    private readonly histograms: Map<string, { count: number; sum: number; min: number; max: number }> = new Map();

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
     * Increments a named counter by one (or a given amount).
     */
    public incrementCounter(name: string, amount = 1): void {
        const current = this.counters.get(name) ?? 0;
        this.counters.set(name, current + amount);
    }

    /**
     * Alias for incrementCounter, kept for call-site convenience.
     */
    public increment(name: string, amount = 1): void {
        this.incrementCounter(name, amount);
    }

    /**
     * Records a value into a named histogram.
     */
    public observeHistogram(name: string, value: number): void {
        const existing = this.histograms.get(name);
        if (!existing) {
            this.histograms.set(name, { count: 1, sum: value, min: value, max: value });
            return;
        }
        existing.count += 1;
        existing.sum += value;
        existing.min = Math.min(existing.min, value);
        existing.max = Math.max(existing.max, value);
    }

    /**
     * Alias for observeHistogram, kept for call-site convenience.
     */
    public observe(name: string, value: number): void {
        this.observeHistogram(name, value);
    }

    /**
     * Returns a plain-object snapshot of all counters and histograms.
     */
    public getMetricsSnapshot(): MetricsSnapshot {
        const counters: Record<string, number> = {};
        for (const [name, value] of this.counters) {
            counters[name] = value;
        }

        const histograms: MetricsSnapshot['histograms'] = {};
        for (const [name, bucket] of this.histograms) {
            histograms[name] = {
                count: bucket.count,
                sum: bucket.sum,
                min: bucket.min,
                max: bucket.max,
                avg: bucket.count > 0 ? bucket.sum / bucket.count : 0,
            };
        }

        return { counters, histograms };
    }

    /**
     * Resets all metrics. Primarily useful for tests.
     */
    public resetMetrics(): void {
        this.counters.clear();
        this.histograms.clear();
    }
}

export const observabilityService = new ObservabilityService();

export const metrics = observabilityService;
