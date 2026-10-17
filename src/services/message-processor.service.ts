import { WhatsAppService, SendMessageResult } from './whatsapp.service';
import { StellarService } from './stellar.service';
import { SorobanService } from './soroban.service';
import * as StellarSdk from '@stellar/stellar-sdk';
import { UserService } from './user.service';
import { GroupService } from './group.service';
import { PayoutService } from './payout.service';
import { GroupExitService, GroupExitError } from './group-exit.service';
import { PaymentRequestService, PaymentRequestError } from './payment-request.service';
import { scheduleRequestCompletion, scheduleRequestExpiry } from '../queue/payment-request.queue';
import { decrypt } from '../utils/encryption.util';
import { t, isSupportedLanguage, loadLocale } from './locale.service';
import { redisClient } from '../lib/redis';
import { registerSecret, unregisterSecret, zeroAllInFlightSecrets } from '../utils/secret-registry';
import { logSecretAccess } from '../utils/audit-logger';

/**
 * Logs a failed delivery attempt. Delivery failures are never rethrown from
 * notification paths — they are surfaced here so operators can see them, while
 * the caller decides whether the failure is actionable.
 */
function logDeliveryFailure(context: string, result: SendMessageResult): void {
    if (!result.delivered) {
        console.error(`[whatsapp] delivery failed (${context}): ${result.failureClass}`, result.error);
    }
}

/**
 * Sends a message and logs any delivery failure. The result is returned so
 * callers can react to a failed delivery instead of assuming success.
 * Callers that do not need the result may ignore it; the failure is still logged.
 */
async function sendAndLog(
    whatsappService: WhatsAppService,
    to: string,
    body: string,
    context: string,
): Promise<SendMessageResult> {
    const result = await whatsappService.sendMessage(to, body);
    logDeliveryFailure(context, result);
    return result;
}

export class MessageProcessor {
    private whatsappService: WhatsAppService;
    private stellarService: StellarService;
    private sorobanService: SorobanService;
    private userService: UserService;
    private groupService: GroupService;
    private payoutService: PayoutService;
    private paymentRequestService: PaymentRequestService;
    private groupExitService: GroupExitService;

    constructor(
        whatsappService?: WhatsAppService,
        stellarService?: StellarService,
        userService?: UserService,
        groupService?: GroupService,
        payoutService?: PayoutService,
        paymentRequestService?: PaymentRequestService,
        sorobanService?: SorobanService,
        groupExitService?: GroupExitService,
    ) {
        this.whatsappService = whatsappService ?? new WhatsAppService();
        this.stellarService = stellarService ?? new StellarService();
        this.sorobanService = sorobanService ?? new SorobanService();
        this.userService = userService ?? new UserService();
        this.groupService = groupService ?? new GroupService();
        this.payoutService = payoutService ?? new PayoutService();
        this.paymentRequestService = paymentRequestService ?? new PaymentRequestService(this.stellarService);
        this.groupExitService = groupExitService
            ?? new GroupExitService(this.payoutService, this.sorobanService, this.whatsappService);
    }

    /**
     * Validates a contribution amount string for financial operations.
     *
     * Returns null when the amount is valid, or a translation key describing
     * the specific validation failure. Rules enforced:
     * - Must match the pattern for a non-negative decimal number
     * - Must be strictly greater than zero
     * - Must not exceed 7 decimal places (Stellar's smallest unit is 1 stroop = 0.0000001 XLM)
     * - Must not exceed 1,000,000 XLM (guards against fat-finger errors)
     */
    private validateAmount(amountStr: string): string | null {
        if (!/^\d+(\.\d+)?$/.test(amountStr)) {
            return 'validation.invalid_format';
        }
        const value = parseFloat(amountStr);
        if (value <= 0) {
            return 'validation.zero_amount';
        }
        const decimalPart = amountStr.includes('.') ? amountStr.split('.')[1] : '';
        if (decimalPart.length > 7) {
            return 'validation.precision_exceeded';
        }
        if (value > 1_000_000) {
            return 'validation.exceeds_max';
        }
        return null;
    }

    public async processCommand(from: string, text: string, locale?: string) {
        const tokens = text.trim().split(/\s+/);
        if (tokens.length === 0) return;

        // Ensure user is created/fetched with locale early on
        const user = await this.userService.getOrCreateUser(from, locale).catch(e => {
            console.error('Failed early user creation', e);
            return null;
        });

        if (user && user.language) {
            await loadLocale(user.language);
        }

        const cmd1 = tokens[0].toUpperCase();
        const cmd2 = tokens.length > 1 ? tokens[1].toUpperCase() : '';

        try {
            if (cmd1 === 'CREATE' && cmd2 === 'GROUP') {
                return await this.handleCreateGroup(from, tokens.slice(2));
            } else if (cmd1 === 'JOIN' && cmd2 === 'GROUP') {
                return await this.handleJoinGroup(from, tokens.slice(2));
            } else if (cmd1 === 'INVITE' && cmd2 === 'MEMBER') {
                return await this.handleInviteMember(from, tokens.slice(2));
            } else if (cmd1 === 'GROUP' && cmd2 === 'STATUS') {
                return await this.handleGroupStatus(from, tokens.slice(2));
            } else if (cmd1 === 'LEAVE' && cmd2 === 'GROUP') {
                return await this.handleLeaveGroup(from, tokens.slice(2));
            } else if (cmd1 === 'KICK') {
                return await this.handleKickMember(from, tokens.slice(1));
            } else if (cmd1 === 'PAYOUT') {
                return await this.handlePayoutCommand(from, cmd2, tokens.slice(2));
            }

            switch (cmd1) {
                case 'LANGUAGE':
                    return await this.handleLanguage(from, tokens.slice(1));
                case 'BALANCE':
                    return await this.handleBalance(from, tokens.slice(1));
                case 'HISTORY':
                    return await this.handleHistory(from, tokens.slice(1));
                case 'PROFILE':
                    return await this.handleProfile(from);
                case 'SEND':
                    return await this.handleSend(from, tokens.slice(1));
                case 'REQUEST':
                    return await this.handleRequest(from, tokens.slice(1));
                case 'ACCEPT':
                    return await this.handleAcceptRequest(from, tokens.slice(1));
                case 'DECLINE':
                    return await this.handleDeclineRequest(from, tokens.slice(1));
                case 'CONTRIBUTE':
                    return await this.handleContribute(from, tokens.slice(1));
                case 'WITHDRAW':
                    return await this.handleWithdraw(from, tokens.slice(1));
                case 'HELP':
                case 'SUPPORT':
                    return await this.handleHelp(from);
                default:
                    return await this.handleUnknown(from, text);
            }
        } catch (error: any) {
            console.error('Error processing command:', error);
            const user = await this.userService.getOrCreateUser(from, locale).catch(() => ({ language: 'en' }));
            await sendAndLog(this.whatsappService,
                from,
                t('error.generic', user.language ?? 'en', { message: error.message }),
                'processCommand.error',
            );
        }
    }

    private async handleLanguage(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        let lang = user.language ?? 'en';
        
        if (args.length === 0) {
            return await sendAndLog(this.whatsappService, from, t('language.current', lang, { current: lang }), 'language.current');
        }

        const requestedLang = args[0].toLowerCase();
        
        // Map common names to codes
        const langMap: Record<string, string> = {
            'english': 'en',
            'french': 'fr',
            'yoruba': 'yo',
            'pidgin': 'pcm',
            'hausa': 'ha',
            'igbo': 'ig'
        };

        const targetCode = langMap[requestedLang] || requestedLang;
        
        if (!isSupportedLanguage(targetCode)) {
            return await sendAndLog(this.whatsappService, from, t('language.unsupported', lang), 'language.unsupported');
        }

        await this.userService.updateUserLanguage(from, targetCode);
        await loadLocale(targetCode);
        return await sendAndLog(this.whatsappService, from, t('language.success', targetCode), 'language.success');
    }

    private async handleBalance(from: string, args: string[] = []) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (!user.stellarWallet) {
            return await sendAndLog(this.whatsappService, from, t('balance.no_wallet', lang), 'balance.no_wallet');
        }
        const { publicKey } = JSON.parse(user.stellarWallet);
        const balances = await this.stellarService.checkBalance(publicKey);

        const assetFilter = args[0]?.toUpperCase();
        const shown = assetFilter ? balances.filter((b) => b.assetCode === assetFilter) : balances;

        if (assetFilter && shown.length === 0) {
            return await sendAndLog(this.whatsappService,
                from,
                t('balance.asset_not_found', lang, { asset: assetFilter }),
                'balance.asset_not_found',
            );
        }

        const balanceLines = shown.map((b) => `${b.assetCode}: ${b.balance}`).join('\n');
        await sendAndLog(this.whatsappService, from, t('balance.success', lang, { balances: balanceLines }), 'balance.success');
    }

    private async handleHistory(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (!user.stellarWallet) {
            return await sendAndLog(this.whatsappService, from, t('history.no_wallet', lang), 'history.no_wallet');
        }

        const isMore = args.length > 0 && args[0].toUpperCase() === 'MORE';
        let cursor = undefined;

        const cursorCacheKey = `user_state:${from}:history_cursor`;
        if (isMore) {
            const savedCursor = await redisClient.get(cursorCacheKey);
            if (savedCursor) {
                cursor = savedCursor;
            } else {
                return await sendAndLog(this.whatsappService, from, t('history.no_more', lang), 'history.no_more');
            }
        }

        await sendAndLog(this.whatsappService, from, t('history.fetching', lang, { phone: from }), 'history.fetching');

        const { publicKey } = JSON.parse(user.stellarWallet);

        try {
            const history = await this.stellarService.getTransactionHistory(publicKey, cursor, 10);
            
            if (history.transactions.length === 0) {
                if (isMore) {
                    await redisClient.del(cursorCacheKey);
                    return await sendAndLog(this.whatsappService, from, t('history.no_more', lang), 'history.no_more');
                } else {
                    return await sendAndLog(this.whatsappService, from, t('history.not_funded', lang), 'history.not_funded');
                }
            }

            let message = t('history.header', lang);
            let index = 1;

            for (const tx of history.transactions) {
                let displayCounterparty = tx.counterparty;
                
                // Attempt to resolve Kolo username if it's a stellar public key
                if (tx.counterparty && tx.counterparty.startsWith('G') && tx.counterparty.length === 56) {
                    const counterpartyUser = await this.userService.getUserByPublicKey(tx.counterparty);
                    if (counterpartyUser && counterpartyUser.username) {
                        displayCounterparty = '@' + counterpartyUser.username;
                    } else {
                        // Shorten address if not found or no username
                        displayCounterparty = tx.counterparty.substring(0, 5) + '...' + tx.counterparty.substring(52);
                    }
                }

                const dateStr = new Date(tx.date).toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
                const shortHash = tx.hash.substring(0, 5) + '...' + tx.hash.substring(52);

                if (tx.type === 'payment sent') {
                    message += t('history.item_sent', lang, {
                        index, amount: tx.amount, asset: tx.asset, counterparty: displayCounterparty, date: dateStr, hash: shortHash
                    });
                } else if (tx.type === 'payment received') {
                    message += t('history.item_received', lang, {
                        index, amount: tx.amount, asset: tx.asset, counterparty: displayCounterparty, date: dateStr, hash: shortHash
                    });
                } else {
                    message += t('history.item_other', lang, {
                        index, type: tx.type, amount: tx.amount, asset: tx.asset, date: dateStr, hash: shortHash
                    });
                }
                message += '\n';
                index++;
            }

            if (history.nextCursor) {
                message += t('history.more', lang);
                await redisClient.set(cursorCacheKey, history.nextCursor, 'EX', 3600); // 1 hour TTL
            } else {
                await redisClient.del(cursorCacheKey);
            }

            await sendAndLog(this.whatsappService, from, message.trim(), 'history.list');
        } catch (error: any) {
            console.error('History error:', error);
            await sendAndLog(this.whatsappService,
                from,
                error.message || t('history.unavailable', lang)
                , 'history.error',
            );
        }
    }

    private async handleProfile(from: string) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';
        const publicKey = user.stellarWallet ? JSON.parse(user.stellarWallet).publicKey : 'None';
        await sendAndLog(this.whatsappService,
            from,
            t('profile.card', lang, {
                phone: user.phoneNumber,
                username: user.username || 'Not set',
                wallet: publicKey,
                joined: user.createdAt.toDateString(),
            }),
            'profile.card',
        );
    }

    private async handleSend(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 2) {
            return await sendAndLog(this.whatsappService, from, t('send.usage', lang), 'send.usage');
        }
        const amount = args[0];
        const amountError = this.validateAmount(amount);
        if (amountError) {
            return await sendAndLog(this.whatsappService, from, t(amountError, lang), 'send.amount_error');
        }
        const target = args[1];

        if (!user.stellarWallet) {
            return await sendAndLog(this.whatsappService, from, t('send.no_wallet', lang), 'send.no_wallet');
        }

        const recipient = await this.userService.resolveUser(target);
        if (!recipient || !recipient.stellarWallet) {
            return await sendAndLog(this.whatsappService,
                from,
                t('send.no_recipient', lang, { target }),
                'send.no_recipient',
            );
        }

        const senderWallet = JSON.parse(user.stellarWallet);
        let senderSecret: Buffer | null = null;

        try {
            senderSecret = decrypt(senderWallet.encryptedSecret, senderWallet.iv, senderWallet.authTag, senderWallet.keyVersion || user.encryptionKeyVersion);
            registerSecret(senderSecret);
            const recipientPublicKey = JSON.parse(recipient.stellarWallet).publicKey;

            await sendAndLog(this.whatsappService,
                from,
                t('send.initiating', lang, { amount, target }),
                'send.initiating',
            );
            await this.stellarService.sendPayment(senderSecret, recipientPublicKey, amount);
            await sendAndLog(this.whatsappService,
                from,
                t('send.success', lang, { amount, target }),
                'send.success',
            );
            await logSecretAccess(user.id, 'SEND', true);
        } catch (e: any) {
            console.error(e);
            await sendAndLog(this.whatsappService,
                from,
                t('send.failed', lang, { message: e.message || 'Transaction error' }),
                'send.failed',
            );
            await logSecretAccess(user.id, 'SEND', false, e.message);
        } finally {
            if (senderSecret) {
                unregisterSecret(senderSecret);
                senderSecret.fill(0);
            }
        }
    }

    private async handleRequest(from: string, args: string[]) {
        const sender = await this.userService.getOrCreateUser(from);
        const lang = sender.language ?? 'en';

        if (args.length < 2) {
            return await sendAndLog(this.whatsappService, from, t('request.usage', lang), 'request.usage');
        }
        const amount = args[0];
        const amountError = this.validateAmount(amount);
        if (amountError) {
            return await sendAndLog(this.whatsappService, from, t(amountError, lang), 'request.amount_error');
        }
        const target = args[1];

        const recipient = await this.userService.resolveUser(target);
        if (!recipient) {
            return await sendAndLog(this.whatsappService,
                from,
                t('request.no_user', lang, { target }),
                'request.no_user',
            );
        }

        if (recipient.id === sender.id) {
            return await sendAndLog(this.whatsappService, from, t('payment_request.error_self_request', lang), 'request.self');
        }

        let created: { id: string; expiresAt: Date };
        try {
            created = await this.paymentRequestService.createRequest(sender.id, recipient.id, amount);
        } catch (error: any) {
            if (error instanceof PaymentRequestError && error.code === 'too_many_pending') {
                return await sendAndLog(this.whatsappService, from, t('payment_request.error_too_many_pending', lang), 'request.too_many_pending');
            }
            throw error;
        }

        // Schedule expiry for the new request.
        await scheduleRequestExpiry(created.id, created.expiresAt);

        const senderHandle = sender.username ? '@' + sender.username : sender.phoneNumber;
        await sendAndLog(this.whatsappService,
            recipient.phoneNumber,
            t('request.notify_recipient', lang, {
                sender: senderHandle,
                amount,
                senderPhone: sender.phoneNumber,
                requestId: created.id,
            }),
            'request.notify_recipient',
        );
        await sendAndLog(this.whatsappService,
            from,
            t('request.confirmation', lang, { amount, target }),
            'request.confirmation',
        );
    }

    private async handleAcceptRequest(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('payment_request.accept_usage', lang), 'accept.usage');
        }

        try {
            const { request, hash } = await this.paymentRequestService.acceptRequest(args[0], from);

            await scheduleRequestCompletion(request.id);

            return await sendAndLog(this.whatsappService,
                from,
                t('payment_request.accepted', lang, {
                    amount: String(request.amount),
                    asset: request.assetCode,
                    minutes: 5,
                    reclaimHours: 1,
                    hash,
                }),
                'accept.success',
            );
        } catch (error: any) {
            if (error instanceof PaymentRequestError) {
                return await sendAndLog(this.whatsappService,
                    from,
                    t(`payment_request.error_${error.code}`, lang),
                    'accept.error',
                );
            }
            throw error;
        }
    }

    private async handleDeclineRequest(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('payment_request.decline_usage', lang), 'decline.usage');
        }

        try {
            const request = await this.paymentRequestService.declineRequest(args[0], from);

            const requesterPhone = request.requester.phoneNumber;
            if (requesterPhone) {
                await sendAndLog(this.whatsappService,
                    requesterPhone,
                    t('payment_request.declined', request.requester.language ?? 'en', {
                        respondent: request.responder.username ? `@${request.responder.username}` : request.responder.phoneNumber ?? '',
                        amount: String(request.amount),
                        asset: request.assetCode,
                    }),
                    'decline.notify_requester',
                );
            }

            return await sendAndLog(this.whatsappService, from, t('payment_request.decline_confirmed', lang), 'decline.confirmed');
        } catch (error: any) {
            if (error instanceof PaymentRequestError) {
                return await sendAndLog(this.whatsappService,
                    from,
                    t(`payment_request.error_${error.code}`, lang),
                    'decline.error',
                );
            }
            throw error;
        }
    }

    private async handleCreateGroup(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 3) {
            return await sendAndLog(this.whatsappService, from, t('create_group.usage', lang), 'create_group.usage');
        }
        const frequency = args.pop() || 'MONTHLY';
        const amountStr = args.pop() || '0';
        const amountError = this.validateAmount(amountStr);
        if (amountError) {
            return await sendAndLog(this.whatsappService, from, t(amountError, lang), 'create_group.amount_error');
        }
        const name = args.join(' ');

        try {
            const group = await this.groupService.createGroup(user.id, name, amountStr, frequency);
            await sendAndLog(this.whatsappService,
                from,
                t('create_group.success', lang, { name, id: group.id }),
                'create_group.success',
            );
        } catch (e: any) {
            await sendAndLog(this.whatsappService,
                from,
                t('create_group.failed', lang, { message: e.message }),
                'create_group.failed',
            );
        }
    }

    private async handleJoinGroup(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('join_group.usage', lang), 'join_group.usage');
        }
        const groupId = args[0];

        try {
            await this.groupService.joinGroup(user.id, groupId);
            await sendAndLog(this.whatsappService, from, t('join_group.success', lang), 'join_group.success');
        } catch (e: any) {
            await sendAndLog(this.whatsappService,
                from,
                t('join_group.failed', lang, { message: e.message }),
                'join_group.failed',
            );
        }
    }

    private async handleInviteMember(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('invite_member.usage', lang), 'invite_member.usage');
        }
        const target = args[0];
        const recipient = await this.userService.resolveUser(target);

        if (!recipient) {
            return await sendAndLog(this.whatsappService,
                from,
                t('invite_member.no_user', lang, { target }),
                'invite_member.no_user',
            );
        }

        const memberships = await this.groupService.getGroupStatus(user.id);
        const adminGroup = memberships.find((m: any) => m.role === 'CREATOR');

        if (!adminGroup) {
            return await sendAndLog(this.whatsappService,
                from,
                t('invite_member.not_creator', lang),
                'invite_member.not_creator',
            );
        }

        const senderHandle = user.username ? '@' + user.username : user.phoneNumber;
        await sendAndLog(this.whatsappService,
            recipient.phoneNumber,
            t('invite_member.notify_recipient', lang, {
                sender: senderHandle,
                groupName: adminGroup.group.name,
                groupId: adminGroup.groupId,
            }),
            'invite_member.notify_recipient',
        );
        await sendAndLog(this.whatsappService,
            from,
            t('invite_member.success', lang, { target }),
            'invite_member.success',
        );
    }

    private async handleGroupStatus(from: string, _args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';
        const memberships = await this.groupService.getGroupStatus(user.id);

        if (memberships.length === 0) {
            return await sendAndLog(this.whatsappService,
                from,
                t('group_status.no_groups', lang),
                'group_status.no_groups',
            );
        }

        let statusText = t('group_status.header', lang);
        memberships.forEach((m: any) => {
            statusText += t('group_status.entry', lang, {
                name: m.group.name,
                amount: m.group.contributionAmount,
                frequency: m.group.contributionFrequency,
                role: m.role,
                count: m.group.members.length,
            });
        });

        await sendAndLog(this.whatsappService, from, statusText.trim(), 'group_status.list');
    }

    private async handleLeaveGroup(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('leave_group.usage', lang), 'leave_group.usage');
        }
        const groupId = args[0];

        try {
            await this.groupExitService.leaveGroup(user.id, groupId);
            return await sendAndLog(this.whatsappService, from, t('leave_group.success', lang), 'leave_group.success');
        } catch (e: any) {
            if (e instanceof GroupExitError) {
                return await sendAndLog(this.whatsappService, from, t(`group_exit.error_${e.code}`, lang), 'leave_group.error');
            }
            return await sendAndLog(this.whatsappService, from, t('leave_group.failed', lang, { message: e.message }), 'leave_group.failed');
        }
    }

    private async handleKickMember(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 2) {
            return await sendAndLog(this.whatsappService, from, t('kick_member.usage', lang), 'kick_member.usage');
        }
        const [target, groupId] = args;

        const resolved = await this.userService.resolveUser(target);
        if (!resolved) {
            return await sendAndLog(this.whatsappService, from, t('group_exit.error_target_not_found', lang, { target }), 'kick_member.target_not_found');
        }

        try {
            await this.groupExitService.kickMember(user.id, groupId, resolved.id);
            return await sendAndLog(this.whatsappService, from, t('kick_member.success', lang, { target }), 'kick_member.success');
        } catch (e: any) {
            if (e instanceof GroupExitError) {
                return await sendAndLog(this.whatsappService, from, t(`group_exit.error_${e.code}`, lang, { target }), 'kick_member.error');
            }
            return await sendAndLog(this.whatsappService, from, t('kick_member.failed', lang, { message: e.message }), 'kick_member.failed');
        }
    }

    private async handlePayoutCommand(from: string, sub: string, args: string[]) {
        switch (sub) {
            case 'ORDER':
                return await this.handleSetPayoutOrder(from, args);
            case 'STATUS':
                return await this.handlePayoutStatus(from);
            case 'WAIT':
                return await this.handlePayoutWait(from);
            case 'PROCEED':
                return await this.handlePayoutProceed(from);
            case 'SKIP':
                return await this.handlePayoutSkip(from, args);
            default: {
                const user = await this.userService.getOrCreateUser(from);
                return await sendAndLog(this.whatsappService, from, t('payout.usage', user.language ?? 'en'), 'payout.usage');
            }
        }
    }

    private async handleSetPayoutOrder(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length === 0) {
            return await sendAndLog(this.whatsappService, from, t('payout.order_usage', lang), 'payout.order_usage');
        }

        const memberships = await this.groupService.getGroupStatus(user.id);
        const adminGroup = memberships.find((m: any) => m.role === 'CREATOR');
        if (!adminGroup) {
            return await sendAndLog(this.whatsappService, from, t('payout.not_creator', lang), 'payout.not_creator');
        }

        const order: string[] = [];
        for (const target of args) {
            const resolved = await this.userService.resolveUser(target);
            if (!resolved) {
                return await sendAndLog(this.whatsappService, from, t('payout.order_invalid_member', lang, { target }), 'payout.order_invalid_member');
            }
            order.push(resolved.id);
        }

        try {
            await this.payoutService.setPayoutOrder(adminGroup.groupId, user.id, order);
            await sendAndLog(this.whatsappService, from, t('payout.order_success', lang), 'payout.order_success');
        } catch (e: any) {
            await sendAndLog(this.whatsappService, from, t('payout.order_failed', lang, { message: e.message }), 'payout.order_failed');
        }
    }

    private async handlePayoutStatus(from: string) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        const memberships = await this.groupService.getGroupStatus(user.id);
        if (memberships.length === 0) {
            return await sendAndLog(this.whatsappService, from, t('payout.no_group', lang), 'payout.no_group');
        }

        const group = memberships[0].group;
        const order = await this.payoutService.getEffectivePayoutOrder(group.id);
        const nameById = new Map(
            group.members.map((m: any) => [m.userId, m.user.username ? '@' + m.user.username : m.user.phoneNumber]),
        );

        const orderText = order
            .map((id: string, i: number) => `${i + 1}. ${nameById.get(id) || id}${i === (group as any).currentPayoutIndex ? ' ⬅️ next' : ''}`)
            .join('\n');
        const nextId = order[(group as any).currentPayoutIndex];
        const next = nextId ? (nameById.get(nextId) || nextId) : 'N/A';

        await sendAndLog(this.whatsappService, from, t('payout.status', lang, {
            name: group.name,
            cycle: (group as any).totalCycles + 1,
            next,
            order: orderText,
        }), 'payout.status');
    }

    private async handlePayoutWait(from: string) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        const memberships = await this.groupService.getGroupStatus(user.id);
        const adminGroup = memberships.find((m: any) => m.role === 'CREATOR');
        if (!adminGroup) {
            return await sendAndLog(this.whatsappService, from, t('payout.not_creator', lang), 'payout.not_creator');
        }

        try {
            await this.payoutService.extendDeadline(adminGroup.groupId);
            await sendAndLog(this.whatsappService, from, t('payout.wait_success', lang), 'payout.wait_success');
        } catch (e: any) {
            await sendAndLog(this.whatsappService, from, t('payout.wait_failed', lang, { message: e.message }), 'payout.wait_failed');
        }
    }

    private async handlePayoutProceed(from: string) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        const memberships = await this.groupService.getGroupStatus(user.id);
        const adminGroup = memberships.find((m: any) => m.role === 'CREATOR');
        if (!adminGroup) {
            return await sendAndLog(this.whatsappService, from, t('payout.not_creator', lang), 'payout.not_creator');
        }

        try {
            await this.payoutService.proceedWithPartialPool(adminGroup.groupId);
            await sendAndLog(this.whatsappService, from, t('payout.proceed_success', lang), 'payout.proceed_success');
        } catch (e: any) {
            await sendAndLog(this.whatsappService, from, t('payout.proceed_failed', lang, { message: e.message }), 'payout.proceed_failed');
        }
    }

    private async handlePayoutSkip(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('payout.skip_usage', lang), 'payout.skip_usage');
        }

        const memberships = await this.groupService.getGroupStatus(user.id);
        const adminGroup = memberships.find((m: any) => m.role === 'CREATOR');
        if (!adminGroup) {
            return await sendAndLog(this.whatsappService, from, t('payout.not_creator', lang), 'payout.not_creator');
        }

        const target = args[0];
        const resolved = await this.userService.resolveUser(target);
        if (!resolved) {
            return await sendAndLog(this.whatsappService, from, t('payout.skip_no_user', lang, { target }), 'payout.skip_no_user');
        }

        try {
            await this.payoutService.skipDefaultingMember(adminGroup.groupId, user.id, resolved.id);
            await sendAndLog(this.whatsappService, from, t('payout.skip_success', lang, { target }), 'payout.skip_success');
        } catch (e: any) {
            await sendAndLog(this.whatsappService, from, t('payout.skip_failed', lang, { message: e.message }), 'payout.skip_failed');
        }
    }

    private async handleContribute(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('contribute.usage', lang), 'contribute.usage');
        }
        const amountStr = args[0];
        const amountError = this.validateAmount(amountStr);
        if (amountError) {
            return await sendAndLog(this.whatsappService, from, t(amountError, lang), 'contribute.amount_error');
        }

        const memberships = await this.groupService.getGroupStatus(user.id);
        if (memberships.length === 0) {
            return await sendAndLog(this.whatsappService, from, t('contribute.no_group', lang), 'contribute.no_group');
        }

        const group = memberships[0].group;

        if ((group as any).isPaused) {
            return await sendAndLog(this.whatsappService, from, t('contribute.group_paused', lang, { groupName: group.name }), 'contribute.group_paused');
        }

        // Enforce exact match against the group's required contribution amount.
        // Savings circles (Ajo/Esusu) require every member to contribute the
        // same fixed amount each cycle; accepting a different amount would
        // corrupt the payout schedule.
        const required = parseFloat(String(group.contributionAmount));
        const contributed = parseFloat(amountStr);
        if (Math.abs(contributed - required) > Number.EPSILON) {
            return await sendAndLog(this.whatsappService,
                from,
                t('contribute.amount_mismatch', lang, { required: String(group.contributionAmount) }),
                'contribute.amount_mismatch',
            );
        }

        if (!user.stellarWallet) {
            return await sendAndLog(this.whatsappService, from, t('send.no_wallet', lang), 'contribute.no_wallet');
        }
        if (!group.stellarContractId) {
            return await sendAndLog(this.whatsappService, from, t('error.generic', lang, { message: 'Group has no Soroban contract configured.' }), 'contribute.no_contract');
        }

        const senderWallet = JSON.parse(user.stellarWallet);
        let senderSecret: Buffer | null = null;

        try {
            senderSecret = decrypt(senderWallet.encryptedSecret, senderWallet.iv, senderWallet.authTag, senderWallet.keyVersion || user.encryptionKeyVersion);
            registerSecret(senderSecret);

            const memberKeypair = StellarSdk.Keypair.fromRawEd25519Seed(senderSecret);
            const memberPublicKey = memberKeypair.publicKey();

            // Convert XLM amount (decimal) to stroops (i128) for the Soroban contract.
            // 1 XLM = 10_000_000 stroops.
            const amountStroops = BigInt(Math.round(parseFloat(amountStr) * 10_000_000));

            await sendAndLog(this.whatsappService,
                from,
                t('contribute.initiating', lang, { amount: amountStr, groupName: group.name }),
                'contribute.initiating',
            );

            // ── Contract-first contribution flow ─────────────────────────────────
            // We invoke the Soroban contract's contribute() and only write to the
            // DB after on-chain confirmation.  This keeps both sources of truth
            // consistent; the reconciliation worker will detect any divergence
            // that slips through a crash between confirmation and the DB write.
            const { hash: txHash, status } = await this.sorobanService.invokeContribute(
                memberKeypair,
                group.stellarContractId,
                memberPublicKey,
                amountStroops,
            );

            if (status === 'PENDING') {
                // Transaction submitted but not confirmed within 30 s.
                // Record as PENDING so the reconciliation worker can detect
                // whether it eventually landed on-chain.
                await this.groupService.addContribution(user.id, group.id, amountStr, txHash, 'PENDING');
                await sendAndLog(this.whatsappService,
                    from,
                    t('contribute.pending', lang, { hash: txHash }),
                    'contribute.pending',
                );
                await logSecretAccess(user.id, 'CONTRIBUTE', false, 'Transaction pending confirmation');
                return;
            }

            // status === 'SUCCESS': confirmed on-chain — now safe to write DB record.
            await this.groupService.addContribution(user.id, group.id, amountStr, txHash);
            // The first contribution of a cycle locks the payout order — the creator
            // can no longer reorder once the rotation is underway.
            await this.payoutService.lockOrderForCycle(group.id).catch((e) => console.error('Failed to lock payout order', e));
            await sendAndLog(this.whatsappService,
                from,
                t('contribute.success', lang, { amount: amountStr, groupName: group.name }),
                'contribute.success',
            );
            await logSecretAccess(user.id, 'CONTRIBUTE', true);
        } catch (e: any) {
            // Distinguish a contract-level FAILED transaction from a network error.
            const isTxFailed = e?.message?.includes('Transaction failed on ledger');
            if (isTxFailed) {
                await sendAndLog(this.whatsappService,
                    from,
                    t('contribute.failed_onchain', lang, { message: e.message }),
                    'contribute.failed_onchain',
                );
            } else {
                await sendAndLog(this.whatsappService,
                    from,
                    t('contribute.failed', lang, { message: e.message }),
                    'contribute.failed',
                );
            }
            await logSecretAccess(user.id, 'CONTRIBUTE', false, e.message);
        } finally {
            if (senderSecret) {
                unregisterSecret(senderSecret);
                senderSecret.fill(0);
            }
        }
    }

    private async handleWithdraw(from: string, args: string[]) {
        const user = await this.userService.getOrCreateUser(from);
        const lang = user.language ?? 'en';

        if (args.length < 1) {
            return await sendAndLog(this.whatsappService, from, t('withdraw.usage', lang), 'withdraw.usage');
        }
        const amountStr = args[0];
        const amountError = this.validateAmount(amountStr);
        if (amountError) {
            return await sendAndLog(this.whatsappService, from, t(amountError, lang), 'withdraw.amount_error');
        }

        const memberships = await this.groupService.getGroupStatus(user.id);
        if (memberships.length === 0) {
            return await sendAndLog(this.whatsappService, from, t('withdraw.no_group', lang), 'withdraw.no_group');
        }

        const group = memberships[0].group;
        await sendAndLog(this.whatsappService,
            from,
            t('withdraw.success', lang, { amount: amountStr, groupName: group.name }),
            'withdraw.success',
        );
    }

    private async handleHelp(from: string) {
        const user = await this.userService.getOrCreateUser(from);
        await sendAndLog(this.whatsappService, from, t('help.text', user.language ?? 'en'), 'help.text');
    }

    private async handleUnknown(from: string, _text: string) {
        const user = await this.userService.getOrCreateUser(from);
        await sendAndLog(this.whatsappService, from, t('unknown.command', user.language ?? 'en'), 'unknown.command');
    }
}
