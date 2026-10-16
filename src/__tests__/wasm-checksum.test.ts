import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EXPECTED_WASM_SHA256,
  WASM_PATH,
  computeWasmSha256,
  verifyWasmChecksum,
} from "../../scripts/check-wasm-checksum";

describe("contracts WASM artefact checksum", () => {
  it("ships the checked-in artefact", () => {
    expect(existsSync(WASM_PATH)).toBe(true);
  });

  it("records a 64-character hex sha256 digest", () => {
    expect(EXPECTED_WASM_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the digest of the checked-in binary", () => {
    expect(computeWasmSha256()).toBe(EXPECTED_WASM_SHA256);
    expect(verifyWasmChecksum()).toBe(true);
  });

  it("fails when the artifact changes", () => {
    const tmp = tmpdir();
    const copy = join(tmp, "saving_group.wasm");
    try {
      const original = readFileSync(WASM_PATH);
      writeFileSync(copy, Buffer.concat([original, Buffer.from([0x00])]));
      expect(computeWasmSha256(copy)).not.toBe(EXPECTED_WASM_SHA256);
      expect(verifyWasmChecksum(copy)).toBe(false);
    } finally {
      if (existsSync(copy)) {
        // clean up the temporary copy even if assertions throw
        unlinkSync(copy);
      }
    }
  });
});
