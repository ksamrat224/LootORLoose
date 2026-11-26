/** Shared release assertions; never signs, funds wallets or changes configuration. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PublicKey, Connection } from "@solana/web3.js";
import { PROGRAM_ID } from "../src/lib/chain";
import { newDevnetHuntRules, type Wager } from "../src/lib/hunt-chain";

export function expectedRules(
  args: string[],
  creationRules = newDevnetHuntRules(),
): 5 | 6 {
  const options = args.filter((arg) => arg.startsWith("--expect-rules="));
  const version = Number(options[0]?.split("=")[1]);
  if (options.length !== 1 || (version !== 5 && version !== 6))
    throw new Error(
      "Specify exactly one --expect-rules=5 or --expect-rules=6 before live checks",
    );
  if (creationRules !== version)
    throw new Error(
      `Client creates V${creationRules}, expected V${version}; set NEXT_PUBLIC_HUNT_V6_ENABLED explicitly`,
    );
  return version;
}
export function assertRules(
  hunt: Pick<Wager, "rulesVersion">,
  expected: number,
) {
  if (hunt.rulesVersion !== expected)
    throw new Error(
      `Expected rules V${expected}, received V${hunt.rulesVersion}; this check is not a pass`,
    );
}
export const releaseBinaryPath = () =>
  process.env.LIVE_HUNT_BINARY ||
  resolve(process.cwd(), "../target/deploy/loot_or_lose.so");
export async function verifyRuntimeBinary(connection: Connection) {
  const deployed = await connection.getAccountInfo(PROGRAM_ID);
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const erLoader = new PublicKey("LoaderV411111111111111111111111111111111111");
  const binary = readFileSync(releaseBinaryPath());
  const sha256 = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  if (!deployed?.executable)
    throw new Error("Expected executable program on " + connection.rpcEndpoint);
  let bytes: Uint8Array;
  let programData: string | null = null,
    slot: string | null = null;
  let format: "upgradeable" | "er-inline-elf";
  if (
    deployed.owner.equals(erLoader) &&
    deployed.data.subarray(0, 4).toString("hex") === "7f454c46"
  ) {
    // The ER RPC exposes an inline ELF rather than a base-layer ProgramData pointer.
    bytes = deployed.data;
    format = "er-inline-elf";
  } else {
    if (
      !deployed.owner.equals(loader) ||
      deployed.data.length !== 36 ||
      deployed.data.readUInt32LE(0) !== 2
    )
      throw new Error(
        "Expected upgradeable program on " + connection.rpcEndpoint,
      );
    const address = new PublicKey(deployed.data.subarray(4, 36));
    const data = await connection.getAccountInfo(address);
    if (
      !data ||
      !data.owner.equals(loader) ||
      data.data.length < 45 ||
      data.data.readUInt32LE(0) !== 3
    )
      throw new Error("Invalid ProgramData on " + connection.rpcEndpoint);
    bytes = data.data.subarray(45);
    programData = address.toBase58();
    slot = data.data.readBigUInt64LE(4).toString();
    format = "upgradeable";
  }
  if (
    bytes.length < binary.length ||
    sha256(bytes.subarray(0, binary.length)) !== sha256(binary)
  )
    throw new Error(
      "Binary mismatch on " +
        connection.rpcEndpoint +
        "; no new test funding allowed",
    );
  const evidence = {
    endpoint: connection.rpcEndpoint,
    program: PROGRAM_ID.toBase58(),
    programData,
    slot,
    format,
    bytes: binary.length,
    sha256: sha256(binary),
  };
  console.log("VERIFIED_RUNTIME_BINARY", JSON.stringify(evidence));
  return evidence;
}

export async function retryReleaseRead<T>(
  read: () => Promise<T>,
  pause = (ms: number) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (
        attempt >= 3 ||
        !/fetch failed|timed out|ECONNRESET|socket/i.test(String(error))
      )
        throw error;
      console.log("RELEASE_READ_RETRY", attempt, String(error));
      await pause(250 * attempt);
    }
  }
}
let readRetriesInstalled = false;
export function enableReleaseReadRetries() {
  if (readRetriesInstalled) return;
  readRetriesInstalled = true;
  const info = Connection.prototype.getAccountInfo;
  const blockhash = Connection.prototype.getLatestBlockhash;
  // Release harness only: retry unsigned reads, never simulation, signing or uploads.
  Connection.prototype.getAccountInfo = function (
    ...args: Parameters<typeof info>
  ) {
    return retryReleaseRead(() => info.apply(this, args));
  };
  Connection.prototype.getLatestBlockhash = function (
    ...args: Parameters<typeof blockhash>
  ) {
    return retryReleaseRead(() => blockhash.apply(this, args));
  };
}
