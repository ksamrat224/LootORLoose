import { test, expect } from "@playwright/test";
import { expectedRules, assertRules } from "../scripts/hunt-release";
test("live verification requires one explicit version matching the client", () => {
  for (const version of [5, 6] as const) {
    expect(expectedRules([`--expect-rules=${version}`], version)).toBe(version);
    expect(() => assertRules({ rulesVersion: version }, version)).not.toThrow();
    expect(() =>
      assertRules({ rulesVersion: version === 5 ? 6 : 5 }, version),
    ).toThrow("not a pass");
  }
  for (const args of [
    [],
    ["--expect-rules=7"],
    ["--expect-rules=5", "--expect-rules=6"],
  ])
    expect(() => expectedRules(args, 5)).toThrow("Specify exactly one");
  expect(() => expectedRules(["--expect-rules=6"], 5)).toThrow(
    "Client creates V5",
  );
  expect(() => expectedRules(["--expect-rules=5"], 6)).toThrow(
    "Client creates V6",
  );
});

test("release verification accepts actual base/ER layouts and rejects wrong bytes or owners", async () => {
  const { Connection, PublicKey } = await import("@solana/web3.js");
  const { readFileSync } = await import("node:fs");
  const { verifyRuntimeBinary, releaseBinaryPath } = await import(
    "../scripts/hunt-release"
  );
  const { PROGRAM_ID } = await import("../src/lib/chain");
  const binary = readFileSync(releaseBinaryPath());
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const erLoader = new PublicKey("LoaderV411111111111111111111111111111111111");
  const pointer = PublicKey.unique();
  const header = Buffer.alloc(36);
  header.writeUInt32LE(2);
  pointer.toBuffer().copy(header, 4);
  const data = Buffer.alloc(45 + binary.length);
  data.writeUInt32LE(3);
  data.writeBigUInt64LE(BigInt(42), 4);
  binary.copy(data, 45);
  const info = (
    owner: InstanceType<typeof PublicKey>,
    bytes: Buffer,
    executable = false,
  ) => ({
    owner,
    data: bytes,
    executable,
    lamports: 1,
    rentEpoch: 0,
  });
  const connection = new Connection("http://localhost:8899");
  connection.getAccountInfo = async (key) =>
    key.equals(PROGRAM_ID) ? info(loader, header, true) : info(loader, data);
  expect((await verifyRuntimeBinary(connection)).slot).toBe("42");
  connection.getAccountInfo = async () => info(erLoader, binary, true);
  expect((await verifyRuntimeBinary(connection)).format).toBe("er-inline-elf");
  const wrong = Buffer.from(binary);
  wrong[100] ^= 1;
  connection.getAccountInfo = async () => info(erLoader, wrong, true);
  await expect(verifyRuntimeBinary(connection)).rejects.toThrow(
    "Binary mismatch",
  );
  connection.getAccountInfo = async () => info(PublicKey.default, binary, true);
  await expect(verifyRuntimeBinary(connection)).rejects.toThrow(
    "Expected upgradeable",
  );
});

test("bounded release retries apply only to transient reads and preserve failures", async () => {
  const { retryReleaseRead } = await import("../scripts/hunt-release");
  let reads = 0;
  expect(
    await retryReleaseRead(
      async () => {
        if (++reads < 3) throw new Error("fetch failed");
        return 42;
      },
      async () => {},
    ),
  ).toBe(42);
  expect(reads).toBe(3);
  reads = 0;
  await expect(
    retryReleaseRead(
      async () => {
        reads++;
        throw new Error("fetch failed");
      },
      async () => {},
    ),
  ).rejects.toThrow("fetch failed");
  expect(reads).toBe(3);
  reads = 0;
  await expect(
    retryReleaseRead(
      async () => {
        reads++;
        throw new Error("Invalid owner");
      },
      async () => {},
    ),
  ).rejects.toThrow("Invalid owner");
  expect(reads).toBe(1);
});
