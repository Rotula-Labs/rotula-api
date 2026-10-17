import { parseStellarWallet } from '../utils/wallet.util';

const validBlob = {
    publicKey: 'G_PUB',
    encryptedSecret: 'ENC_SEC',
    iv: 'IV',
    authTag: 'TAG',
    keyVersion: 1,
};

describe('parseStellarWallet', () => {
    it('reports an absent wallet for a null, undefined or blank column', () => {
        expect(parseStellarWallet(null)).toEqual({ status: 'absent' });
        expect(parseStellarWallet(undefined)).toEqual({ status: 'absent' });
        expect(parseStellarWallet('')).toEqual({ status: 'absent' });
        expect(parseStellarWallet('   ')).toEqual({ status: 'absent' });
    });

    it('returns the wallet blob for a canonical row', () => {
        expect(parseStellarWallet(JSON.stringify(validBlob))).toEqual({
            status: 'ok',
            wallet: validBlob,
        });
    });

    it('drops a non-numeric keyVersion instead of rejecting the blob', () => {
        const { keyVersion: _keyVersion, ...rest } = validBlob;
        expect(parseStellarWallet(JSON.stringify({ ...rest, keyVersion: '1' }))).toEqual({
            status: 'ok',
            wallet: rest,
        });
    });

    const unreadableCases: Array<[string, string]> = [
        ['truncated JSON', '{"publicKey":"G_PUB",'],
        ['a pre-encryption bare public key', 'G_PUB'],
        ['a JSON string', '"G_PUB"'],
        ['a JSON array', '["G_PUB"]'],
        ['JSON null', 'null'],
        ['an object without publicKey', JSON.stringify({ ...validBlob, publicKey: undefined })],
        ['an object with a blank publicKey', JSON.stringify({ ...validBlob, publicKey: '   ' })],
        ['an object without the encrypted secret', JSON.stringify({ ...validBlob, encryptedSecret: undefined })],
    ];

    it.each(unreadableCases)('reports unreadable for %s', (_label, raw) => {
        expect(parseStellarWallet(raw)).toEqual({ status: 'unreadable' });
    });

    it('never throws on arbitrary non-JSON input', () => {
        expect(() => parseStellarWallet('not json at all \u0000')).not.toThrow();
    });
});
