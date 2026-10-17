import axios from 'axios';
import * as StellarSdk from '@stellar/stellar-sdk';
import path from 'path';
import { SorobanService } from '../services/soroban.service';
import { config } from '../config/env';

jest.setTimeout(120000);

// This suite uploads and deploys a real contract to Stellar Testnet, so it
// needs both network access and a compiled artifact at
// contracts/savings_group.wasm. The repository ships an 8-byte placeholder,
// which the Soroban host rejects with "contract missing metadata section".
// Run it explicitly once a real build is present:
//   RUN_SOROBAN_INTEGRATION=1 npm test
const describeIntegration =
    process.env.RUN_SOROBAN_INTEGRATION === '1' ? describe : describe.skip;

describeIntegration('SorobanService Integration', () => {
    let sorobanService: SorobanService;
    let deployerKeypair: StellarSdk.Keypair;

    const contractWasmPath = path.resolve(__dirname, '../../contracts/savings_group.wasm');

    beforeAll(() => {
        config.STELLAR_NETWORK = 'TESTNET';
        sorobanService = new SorobanService();
    });

    async function fundTestnetAccount(publicKey: string): Promise<void> {
        const response = await axios.get(`https://friendbot.stellar.org?addr=${encodeURIComponent(publicKey)}`);
        if (response.status !== 200) {
            throw new Error(`Friendbot funding failed with status ${response.status}`);
        }
    }

    it('deploys a Soroban contract on testnet and executes initialize()', async () => {
        deployerKeypair = StellarSdk.Keypair.random();

        await fundTestnetAccount(deployerKeypair.publicKey());
        await new Promise((resolve) => setTimeout(resolve, 5000));

        config.DEPLOYER_SECRET_KEY = deployerKeypair.secret();

        const wasmBuffer = sorobanService.loadContractWasm(contractWasmPath);
        expect(wasmBuffer.length).toBeGreaterThan(0);

        const { wasmHash } = await sorobanService.uploadWasm(deployerKeypair, wasmBuffer);
        expect(wasmHash).toBeInstanceOf(Buffer);
        expect(wasmHash.length).toBeGreaterThan(0);

        const { contractId } = await sorobanService.createCustomContract(deployerKeypair, wasmHash);
        expect(typeof contractId).toBe('string');
        expect(contractId).toMatch(/^C/);

        const initializeResult = await sorobanService.initializeContract(deployerKeypair, contractId, {
            admin: deployerKeypair.publicKey(),
            usdcTokenAddress: config.USDC_TOKEN_ADDRESS,
            groupName: 'Test Group',
            contributionAmount: '100',
        });

        expect(initializeResult).toHaveProperty('txHash');
        expect(typeof initializeResult.txHash).toBe('string');

        const txStatus = await sorobanService.server.getTransaction(initializeResult.txHash);
        expect((txStatus as any).status).toBe('SUCCESS');
    });
});
