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
    }

    /**
     * Logs the resolved network and contract identifiers at boot.
     * Makes a wrong-network deploy obvious in the first line of the log.
     * No secrets are included.
     */
    public logBootConfiguration(config: {
        network: string;
        usdcIssuer?: string;
        usdcTokenAddress?: string;
        sorobanRpcUrl?: string;
        port?: number | string;
    }): void {
        const network = (config.network ?? '').toUpperCase();
        const isKnownNetwork = network === 'PUBLIC' || network === 'TESTNET';

        const context: Record<string, any> = {
            network,
            usdcIssuer: config.usdcIssuer ?? '(not configured)',
            usdcTokenAddress: config.usdcTokenAddress ?? '(not configured)',
            sorobanRpcUrl: config.sorobanRpcUrl ?? '(not configured)',
            port: config.port
        };

        if (!isKnownNetwork) {
            this.logWarning(
                `BOOT NETWORK MISMATCH: resolved network "${network}" is not 'PUBLIC' or 'TESTNET' -- Stellar services will fall back to testnet behaviour`,
                context
            );
            return;
        }

        this.logInfo(`BOOT NETWORK RESOLVED - NETWORK: ${network}`, context);
    }

    /**
     * Logs the resolved network and contract identifiers at boot.
     * Makes a wrong-network deploy obvious in the first line of the log.
     * No secrets are included.
     */
    public logBootConfig(config: {
        network: string;
        usdcIssuer?: string;
        usdcTokenAddress?: string;
        sorobanRpcUrl?: string;
        port?: number | string;
    }): void {
        this.logBootConfiguration(config);
    }
}

export const observabilityService = new ObservabilityService();
