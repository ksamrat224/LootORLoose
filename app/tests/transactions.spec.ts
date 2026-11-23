import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import idl from "../src/lib/loot_or_lose.json";
import { createServer, type Server } from "node:http";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  PendingSubmission,
  submissionStatus,
  submitSession,
} from "../src/lib/chain";

test("the browser IDL matches the built program and preserves legacy layouts", () => {
  const generated = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../target/idl/loot_or_lose.json"),
      "utf8"
    )
  );
  expect(idl).toEqual(generated);
  const fields = (name: string) => {
    const type = idl.types.find((entry) => entry.name === name);
    return type && "fields" in type.type
      ? type.type.fields?.map((field) => field.name) ?? []
      : [];
  };
  expect(fields("RunState")).not.toContain("session_signer");
  expect(fields("WagerState")).toContain("session_signer");
});

test("an ambiguous send retains its signed transaction identity", async () => {
  const signer = Keypair.generate();
  const connection = Object.assign(
    new Connection("http://localhost:8899", "confirmed"),
    {
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 99,
      }),
      simulateTransaction: async () => ({ value: { err: null } }),
      sendRawTransaction: async () => {
        throw new Error("Connection lost after upload");
      },
    }
  );
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: signer.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    })
  );
  let caught: unknown;
  try {
    await submitSession(
      connection,
      {
        signer,
        token: Keypair.generate().publicKey,
        authority: signer.publicKey,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      },
      tx
    );
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(PendingSubmission);
  expect((caught as PendingSubmission).signature).toMatch(
    /^[1-9A-HJ-NP-Za-km-z]{80,90}$/
  );
  expect((caught as PendingSubmission).lastValidBlockHeight).toBe(99);
});

test("signature recovery distinguishes pending, applied, failure and expiry", async () => {
  let status: object | null = null;
  let height = 50;
  const server: Server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body);
    const result =
      rpc.method === "getSignatureStatuses"
        ? { context: { slot: 1 }, value: [status] }
        : height;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing RPC port");
    const pending = new PendingSubmission(
      "1".repeat(88),
      100,
      `http://127.0.0.1:${address.port}`,
      "timeout"
    );
    expect(await submissionStatus(pending)).toBe("pending");
    status = {
      slot: 1,
      confirmations: 1,
      err: null,
      confirmationStatus: "confirmed",
    };
    expect(await submissionStatus(pending)).toBe("applied");
    status = {
      slot: 1,
      confirmations: 1,
      err: { InstructionError: [0, "InvalidArgument"] },
      confirmationStatus: "confirmed",
    };
    expect(await submissionStatus(pending)).toBe("rejected");
    status = null;
    height = 101;
    expect(await submissionStatus(pending)).toBe("rejected");
    status = {
      slot: 1,
      confirmations: 0,
      err: null,
      confirmationStatus: "processed",
    };
    expect(await submissionStatus(pending)).toBe("pending");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
