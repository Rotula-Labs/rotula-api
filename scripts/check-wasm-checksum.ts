import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Sha256 of the checked-in Soroban contract artefact.
 *
 * This value is the authoritative record of the binary and is documented in
 * `contracts/README.md`. Update both together whenever the artefact is rebuilt.
 */
export const EXPECTED_WASM_SHA256 =
  "c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2";

/**
 * Absolute path to the checked-in WASM artefact.
 */
export const WASM_PATH = resolve(__dirname, "..", "contracts", "saving_group.wasm");


/**
 * Compute the sha256 digest of a file on disk.
 */
export function computeWasmSha256(filePath: string = WASM_PATH): string {
  const buffer = readFileSync(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Returns true when the checked-in artefact matches the expected digest.
 */
export function verifyWasmChecksum(filePath: string = WASM_PATH): boolean {
  return computeWasmSha256(filePath) === EXPECTED_WASM_SHA256;
}

function main(): void {
  const actual = computeWasmSha256();
  if (actual !== EXPECTED_WASM_SHA256) {
    console.error(
      `contracts/saving_group.wasm checksum mismatch\n` +
        `  expected: ${EXPECTED_WASM_SHA256}\n` +
        `  actual:   ${actual}\n` +
        `  Update contracts/README.md and EXPECTED_WASM_SHA256 if the artefact was intentionally rebuilt.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`contracts/saving_group.wasm sha256 ok: ${actual}`);
}

if (require.main === module) {
  main();
}
