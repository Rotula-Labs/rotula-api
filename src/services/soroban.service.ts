import * as StellarSdk from '@stellar/stellar-sdk';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config/env';
import { observabilityService } from './observability.service';
import { stellarService } from './stellar.service';

// Module-level compatibility aliases for issue requirements
if (!(StellarSdk.Operation as any).uploadWasm) {
    (StellarSdk.Operation as any).uploadWasm = StellarSdk.Operation.uploadContractWasm;
}

if (!(StellarSdk as any).SorobanRpc) {
    (StellarSdk as any).SorobanRpc = StellarSdk.rpc;
}

export interface DeployGroupContractParams {
    groupId: string;
    name: string;
    contributionAmount: string | number | bigint;
    adminPublicKey?: string;
    wasmPath?: string;
}

export interface DeploymentResult {
    contractId: string;
    latency: number;
}

/**
 * Low-level helper for deploying and invoking Soroban contracts.
 *
 * This service is intentionally designed to work against the configured
 * Soroban RPC endpoint and to operate in both testnet and public network modes.
 */
export class SorobanService {
    public server: StellarSdk.rpc.Server;

    /**
     * Create a SorobanService binding to the configured RPC endpoint.
     *
     * @param rpcUrl optional override for the Soroban RPC endpoint URL.
     */
    constructor(rpcUrl?: string) {
        const url = rpcUrl || config.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
        this.server = new StellarSdk.rpc.Server(url);
    }

    /**
     * Returns the active Stellar network passphrase based on application config.
     */
    public getNetworkPassphrase(): string {
        return config.STELLAR_NETWORK === 'TESTNET'
            ? StellarSdk.Networks.TESTNET
            : StellarSdk.Networks.PUBLIC;
    }

    /**
     * Loads the compiled .wasm contract binary from a configurable path.
     */
    public loadContractWasm(wasmPath?: string): Buffer {
        const targetPath = wasmPath || config.CONTRACT_WASM_PATH;
        const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);

        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`WASM contract file not found at path: ${resolvedPath}`);
        }

        return fs.readFileSync(resolvedPath);
    }

    /**
     * Simulates transaction, handles retries for PENDING responses, applies restorePreamble if present,
     * and assembles resource limits & bumps fee to >= 1000 stroops.
     */
    public async simulateAndAssembleTransaction(
        tx: StellarSdk.Transaction,
        server?: StellarSdk.rpc.Server
    ): Promise<StellarSdk.Transaction> {
        const srv = server || this.server;
        let simRes: StellarSdk.rpc.Api.SimulateTransactionResponse | null = null;
        let attempts = 0;
        const maxAttempts = 3;

        while (attempts < maxAttempts) {
            attempts++;
            simRes = await srv.simulateTransaction(tx);

            if (simRes && (simRes as any).status === 'PENDING') {
                if (attempts < maxAttempts) {
                    await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
                    continue;
                }
            }
            break;
        }

        if (!simRes) {
            throw new Error('Simulation failed: No response received from Soroban RPC.');
        }

        if (StellarSdk.rpc.Api.isSimulationError(simRes)) {
            throw new Error(`Simulation failed: ${(simRes as any).error || 'Unknown simulation error'}`);
        }

        // Handle restorePreamble for expired ledger entries
        if ((simRes as any).restorePreamble) {
            const preamble = (simRes as any).restorePreamble;
            if (preamble.transactionData) {
                // In the raw RPC response, transactionData is a base64 XDR string.
                // After parseRawSimulation, it becomes a SorobanDataBuilder instance.
                const sorobanData = typeof preamble.transactionData === 'string'
                    ? new StellarSdk.SorobanDataBuilder(preamble.transactionData).build()
                    : preamble.transactionData.build();

                tx = StellarSdk.TransactionBuilder.cloneFrom(tx, {
                    fee: tx.fee,
                    sorobanData,
                }).build();
            }
        }

        // Assemble transaction to attach resource limits from simulation
        const txBuilder = StellarSdk.rpc.assembleTransaction(tx, simRes);
        let assembledTx = txBuilder.build();

        // Enforce fee bumping: if base fee < 1000 stroops, bump to 1000
        const currentFee = Number(assembledTx.fee);
        if (isNaN(currentFee) || currentFee < 1000) {
            assembledTx = StellarSdk.TransactionBuilder.cloneFrom(assembledTx, {
                fee: '1000',
            }).build();
        }

        return assembledTx;
    }

    /**
     * Signs and submits a transaction, polling until confirmed or the poll limit
     * is reached.
     *
     * @returns `{ hash, status }` where status is `'SUCCESS'` when confirmed,
     *   `'PENDING'` when the poll limit expired before confirmation, or throws
     *   when the network returns an error or the transaction is `FAILED`.
     */
    public async submitTransaction(
        tx: StellarSdk.Transaction,
        signerKeypair: StellarSdk.Keypair,
        server?: StellarSdk.rpc.Server,
        options?: { maxPolls?: number; pollIntervalMs?: number }
    ): Promise<{ hash: string; status: 'SUCCESS' | 'PENDING' }> {
        const srv = server || this.server;
        const maxPolls = options?.maxPolls ?? 10;
        const pollIntervalMs = options?.pollIntervalMs ?? 2000;

        tx.sign(signerKeypair);

        const response = await srv.sendTransaction(tx);
        const responseStatus = (response as any).status as string;

        if (responseStatus === 'ERROR') {
            throw new Error(`Transaction submission failed: ${JSON.stringify((response as any).errorResultXdr || response)}`);
        }

        const hash = (response as any).hash as string | undefined;
        if (!hash) {
            throw new Error('Transaction submission did not return a valid hash.');
        }

        // Single choke point: every on-chain operation that reaches the network
        // goes through submitTransaction, so invalidate the signer's cached
        // history here. A failed invalidation is reported, not swallowed.
        try {
            await stellarService.invalidateHistoryCache(signerKeypair.publicKey());
        } catch (err) {
            observabilityService.recordError?.('soroban.invalidateHistoryCache', err as Error);
        }

        if (responseStatus === 'SUCCESS') {
            return { hash, status: 'SUCCESS' };
        }

        // Poll for confirmation if PENDING or TRY_AGAIN_LATER
        let polls = 0;
        while (polls < maxPolls) {
            polls++;
            await new Promise((res) => setTimeout(res, pollIntervalMs));
            const statusRes = await srv.getTransaction(hash);
            const txStatus = (statusRes as any).status as string;

            if (txStatus === 'SUCCESS') {
                return { hash, status: 'SUCCESS' };
            }
            if (txStatus === 'FAILED') {
                throw new Error(`Transaction failed on ledger: ${hash}`);
            }
            // NOT_FOUND or PENDING — keep polling
        }

        // Poll limit reached without confirmation
        return { hash, status: 'PENDING' };
    }

    /**
     * Uploads the WASM binary to the Stellar network using StellarSdk.Operation.uploadContractWasm / uploadWasm.
     */
    public async uploadWasm(
        deployerKeypair: StellarSdk.Keypair,
        wasmBuffer: Buffer,
        server?: StellarSdk.rpc.Server
    ): Promise<{ wasmHash: Buffer; txHash: string }> {
        const srv = server || this.server;
        const account = await srv.getAccount(deployerKeypair.publicKey());

        const uploadOp = (StellarSdk.Operation as any).uploadWasm
            ? (StellarSdk.Operation as any).uploadWasm({ wasm: wasmBuffer })
            : StellarSdk.Operation.uploadContractWasm({ wasm: wasmBuffer });

        let tx = new StellarSdk.TransactionBuilder(account, {
            fee: '1000',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(uploadOp)
            .setTimeout(30)
            .build();

        tx = await this.simulateAndAssembleTransaction(tx, srv);
        const { hash: txHash } = await this.submitTransaction(tx, deployerKeypair, srv);

        const wasmHash = StellarSdk.hash(wasmBuffer);

        return { wasmHash, txHash };
    }

    /**
     * Creates the contract instance using StellarSdk.Operation.createCustomContract().
     */
    public async createCustomContract(
        deployerKeypair: StellarSdk.Keypair,
        wasmHash: Buffer,
        salt?: Buffer,
        server?: StellarSdk.rpc.Server
    ): Promise<{ contractId: string; txHash: string }> {
        const srv = server || this.server;
        const actualSalt = salt || crypto.randomBytes(32);
        const account = await srv.getAccount(deployerKeypair.publicKey());

        const createOp = StellarSdk.Operation.createCustomContract({
            address: new StellarSdk.Address(deployerKeypair.publicKey()),
            wasmHash,
            salt: actualSalt,
        });

        let tx = new StellarSdk.TransactionBuilder(account, {
            fee: '1000',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(createOp)
            .setTimeout(30)
            .build();

        tx = await this.simulateAndAssembleTransaction(tx, srv);
        const { hash: txHash } = await this.submitTransaction(tx, deployerKeypair, srv);

        // Derive contract ID from address, salt, and network passphrase
        const preimage = StellarSdk.xdr.HashIdPreimage.envelopeTypeContractId(
            new StellarSdk.xdr.HashIdPreimageContractId({
                networkId: StellarSdk.hash(Buffer.from(this.getNetworkPassphrase())),
                contractIdPreimage: StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                    new StellarSdk.xdr.ContractIdPreimageFromAddress({
                        address: new StellarSdk.Address(deployerKeypair.publicKey()).toScAddress(),
                        salt: actualSalt,
                    })
                ),
            })
        );
        const contractId = StellarSdk.StrKey.encodeContract(StellarSdk.hash(preimage.toXDR()));

        return { contractId, txHash };
    }

    /**
     * Invokes the initialize() method on the deployed contract with group parameters.
     */
    public async initializeContract(
        deployerKeypair: StellarSdk.Keypair,
        contractId: string,
        params: {
            admin: string;
            usdcTokenAddress: string;
            groupName: string;
            contributionAmount: string | number | bigint;
        },
        server?: StellarSdk.rpc.Server
    ): Promise<{ txHash: string }> {
        const srv = server || this.server;
        const account = await srv.getAccount(deployerKeypair.publicKey());

        const amountBigInt = typeof params.contributionAmount === 'bigint'
            ? params.contributionAmount
            : BigInt(Math.floor(Number(params.contributionAmount)));

        const args = [
            new StellarSdk.Address(params.admin).toScVal(),
            new StellarSdk.Address(params.usdcTokenAddress).toScVal(),
            StellarSdk.nativeToScVal(params.groupName),
            StellarSdk.nativeToScVal(amountBigInt, { type: 'i128' }),
        ];

        const invokeOp = StellarSdk.Operation.invokeContractFunction({
            contract: contractId,
            function: 'initialize',
            args,
        });

        let tx = new StellarSdk.TransactionBuilder(account, {
            fee: '1000',
            networkPassphrase: this.getNetworkPassphrase(),
        })
            .addOperation(invokeOp)
            .setTimeout(30)
            .build();

        tx = await this.simulateAndAssembleTransaction(tx, srv);
        const { hash: txHash } = await this.submitTransaction(tx, deployerKeypair, srv);

        return { txHash };
    }
}
