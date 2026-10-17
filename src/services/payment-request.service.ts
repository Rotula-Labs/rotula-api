import { prisma } from '../lib/prisma';
import { StellarService } from './stellar.service';
import { decrypt } from '../utils/encryption.util';
import { getAssetConfig } from '../config/stellar.config';

export const MAX_PENDING_REQUESTS_PER_USER = 5;
const REQUEST_TTL_HOURS = 24;
const CONFIRMATION_WINDOW_SECONDS = 5 * 60;
const RECLAIM_WINDOW_SECONDS = 60 * 60;
// Retries for recording a successfully placed escrow hold.
const RECORD_RETRIES = 3;
const RETRY_DELAY_MS = 200;

/** Error thrown when a payment request cannot be accepted in its current state. */
export class PaymentRequestError extends Error {
    constructor(public code: 'not_found' | 'not_pending' | 'expired' | 'not_responder' | 'insufficient_balance' | 'too_many_pending') {
        super(`Payment request error: ${code}`);
        this.name = 'PaymentRequestError';
    }
}

/**
 * Tracks P2P payment requests and moves funds through a Stellar claimable
 * balance escrow when the respondent accepts:
 * accept → hold (claimable balance) → confirmation window → requester claims.
 *
 * State transitions are guarded by conditional updates so concurrent ACCEPT,
 * declines and completions can never double-place or double-claim an escrow.
 */
export class PaymentRequestService {
    private stellarService: StellarService;

    constructor(stellarService?: StellarService) {
        this.stellarService = stellarService ?? new StellarService();
    }

    public async createRequest(requesterId: string, responderId: string, amount: string): Promise<{ id: string; expiresAt: Date }> {
        const pendingCount = await prisma.paymentRequest.count({
            where: { requesterId, status: 'PENDING' },
        });
        if (pendingCount >= MAX_PENDING_REQUESTS_PER_USER) {
            throw new PaymentRequestError('too_many_pending');
        }

        // Record the asset the request is denominated in at creation time so a
        // later configuration change cannot alter what the request means.
        // Defaults to the configured asset for legacy rows via resolveRequestAsset.
        const asset = getAssetConfig();

        const expiresAt = new Date(Date.now() + REQUEST_TTL_HOURS * 60 * 60 * 1000);
        const request = await prisma.paymentRequest.create({
            data: {
                requesterId,
                responderId,
                amount,
                assetCode: asset.code,
                assetIssuer: asset.issuer ?? null,
                status: 'PENDING',
                expiresAt,
            },
        });

        return { id: request.id, expiresAt };
    }

    /**
     * Places the escrow hold for the respondent of a still-pending, unexpired
     * request. The status moves PENDING → HOLDING atomically before any Stellar
     * call, so two simultaneous accepts cannot both place a hold.
     */
    public async acceptRequest(
        requestId: string,
        respondentPhoneNumber: string,
    ): Promise<{ request: any; balanceId: string; hash: string }> {
        const request = await this.loadForResponder(requestId, respondentPhoneNumber);

        const wallet = this.parseWallet(request.responder.stellarWallet);
        if (!wallet) {
            throw new PaymentRequestError('not_pending');
        }

        // Honour the asset recorded on the request; fall back to the configured
        // asset for legacy rows created before assets were recorded.
        const asset = this.resolveRequestAsset(request);

        // Confirm the respondent can actually cover the amount before locking funds.
        const balance = await this.getAssetBalance(wallet.publicKey, asset);
        if (parseFloat(balance) < parseFloat(String(request.amount))) {
            throw new PaymentRequestError('insufficient_balance');
        }

        // Atomically claim the right to place the hold.
        const claimed = await prisma.paymentRequest.updateMany({
            where: { id: request.id, status: 'PENDING' },
            data: { status: 'HOLDING' },
        });
        if (claimed.count === 0) {
            throw new PaymentRequestError('not_pending');
        }

        let hash: string;
        let balanceId: string;
        try {
            const secret = decrypt(wallet.encryptedSecret, wallet.iv, wallet.authTag);
            ({ hash, balanceId } = await this.stellarService.createClaimableBalanceWithHold(
                secret,
                this.parseWallet(request.requester.stellarWallet)?.publicKey ?? '',
                String(request.amount),
                RECLAIM_WINDOW_SECONDS,
                asset,
            ));
        } catch (err) {
            // The Stellar call failed, so no funds are locked — release our
            // claim so the request stays answerable.
            await prisma.paymentRequest.updateMany({
                where: { id: request.id, status: 'HOLDING' },
                data: { status: 'PENDING' },
            }).catch(() => undefined);
            throw err;
        }

        // The hold is live on-chain. From here on we must never go back to
        // PENDING — that would let a second ACCEPT rock the funds twice. Retry
        // the recording write; if it still fails the request stays in HOLDING
        // (blocked from accept/decline/expire) with the balance ID logged for
        // recovery.
        let accepted: any = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < RECORD_RETRIES; attempt++) {
            try {
                accepted = await prisma.paymentRequest.update({
                    where: { id: request.id },
                    data: { status: 'ACCEPTED', balanceId },
                });
                break;
            } catch (err) {
                lastError = err;
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
            }
        }

        if (!accepted) {
            console.error(
                `CRITICAL: escrow ${balanceId} is funded for payment request ${request.id} but could not be recorded ` +
                `(status stuck in HOLDING). Manual recovery required.`,
                lastError,
            );
            throw lastError;
        }

        return { request: accepted, balanceId, hash };
    }

    /** Marks a request declined. Only the respondent of a pending request may decline. */
    public async declineRequest(requestId: string, respondentPhoneNumber: string): Promise<any> {
        const request = await this.loadForResponder(requestId, respondentPhoneNumber);

        // Conditional transition: a request being accepted right now can no
        // longer be declined.
        const declined = await prisma.paymentRequest.updateMany({
            where: { id: requestId, status: 'PENDING' },
            data: { status: 'DECLINED' },
        });
        if (declined.count === 0) {
            throw new PaymentRequestError('not_pending');
        }

        return prisma.paymentRequest.findUnique({
            where: { id: requestId },
            include: { requester: true, responder: true },
        }) as Promise<any>;
    }

    /**
     * Called after the confirmation window: the requester claims the held
     * balance, completing the transfer. The ACCEPTED → COMPLETING transition is
     * atomic, so a retried job can never submit a duplicate claim; a failed
     * claim reverts to ACCEPTED for later retries.
     */
    public async completeRequest(requestId: string): Promise<any> {
        const request = await prisma.paymentRequest.findUnique({ where: { id: requestId } });
        if (!request || !request.balanceId) {
            return null;
        }

        const starting = await prisma.paymentRequest.updateMany({
            where: { id: requestId, status: 'ACCEPTED' },
            data: { status: 'COMPLETING' },
        });
        if (starting.count === 0) {
            // Already completed, expired, or another job is claiming it.
            return null;
        }

        const requesterWallet = await prisma.user.findUnique({
            where: { id: request.requesterId },
            select: { stellarWallet: true },
        });
        const wallet = this.parseWallet(requesterWallet?.stellarWallet ?? null);
        if (!wallet) {
            await this.revertToAccepted(requestId);
            return null;
        }

        try {
            const secret = decrypt(wallet.encryptedSecret, wallet.iv, wallet.authTag);
            const { hash } = await this.stellarService.claimClaimableBalance(secret, request.balanceId);

            return prisma.paymentRequest.update({
                where: { id: requestId },
                data: { status: 'COMPLETED', transactionHash: hash },
            });
        } catch (err) {
            console.error(`Failed to claim balance for payment request ${requestId}:`, err);
            await this.revertToAccepted(requestId);
            throw err;
        }
    }

    /** Expires stale pending requests; returns null when nothing changed. */
    public async expireIfPending(requestId: string): Promise<any> {
        const expired = await prisma.paymentRequest.updateMany({
            where: { id: requestId, status: 'PENDING' },
            data: { status: 'EXPIRED' },
        });
        if (expired.count === 0) {
            return null;
        }

        return prisma.paymentRequest.findUnique({ where: { id: requestId } });
    }

    private async revertToAccepted(requestId: string): Promise<void> {
        await prisma.paymentRequest.updateMany({
            where: { id: requestId, status: 'COMPLETING' },
            data: { status: 'ACCEPTED' },
        }).catch(() => undefined);
    }

    private async loadForResponder(requestId: string, respondentPhoneNumber: string) {
        const request = await prisma.paymentRequest.findUnique({
            where: { id: requestId },
            include: { requester: true, responder: true },
        });
        if (!request) throw new PaymentRequestError('not_found');
        if (request.responder.phoneNumber !== respondentPhoneNumber) throw new PaymentRequestError('not_responder');

        if (request.expiresAt.getTime() <= Date.now()) throw new PaymentRequestError('expired');
        if (request.status !== 'PENDING') throw new PaymentRequestError('not_pending');

        return request as any;
    }

    /**
     * Returns the asset a request is denominated in. Requests created after
     * assets were recorded carry their own code/issuer; legacy rows fall back
     * to the currently configured asset.
     */
    private resolveRequestAsset(request: any): { code: string; issuer: string | null } {
        if (request.assetCode) {
            return { code: request.assetCode, issuer: request.assetIssuer ?? null };
        }
        const configured = getAssetConfig();
        return { code: configured.code, issuer: configured.issuer ?? null };
    }

    private parseWallet(stellaeWallet: string | null): { publicKey: string; encryptedSecret: string; iv: string; authTag: string } | null {
        if (!stellaeWallet) return null;
        try {
            return JSON.parse(stellaeWallet);
        } catch {
            return null;
        }
    }

    private async getAssetBalance(
        publicKey: string,
        asset: { code: string; issuer: string | null },
    ): Promise<string> {
        const balances = await this.stellarService.checkBalance(publicKey);
        const match = balances.find(
            (b) => b.assetCode === asset.code && (b.assetIssuer ?? null) === (asset.issuer ?? null),
        );
        return match?.balance ?? '0';
    }
}
