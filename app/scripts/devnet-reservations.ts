/** Read-only accounting: no transactions, keypairs, private material or reservation release. */
import {
  AnchorProvider,
  Program,
  type Idl,
  type AccountClient,
  type BN,
} from "@coral-xyz/anchor";
import {
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import { base, PROGRAM_ID } from "../src/lib/chain";
import { readHouse, readWager } from "../src/lib/hunt-chain";
import idl from "../src/lib/loot_or_lose.json";
const unsigned = {
  publicKey: PublicKey.default,
  signTransaction: async <
    T extends Transaction | VersionedTransaction,
  >(): Promise<T> => {
    throw new Error("Read-only report cannot sign");
  },
  signAllTransactions: async <
    T extends Transaction | VersionedTransaction,
  >(): Promise<T[]> => {
    throw new Error("Read-only report cannot sign");
  },
};
async function main() {
  const client = new Program(
    idl as Idl,
    new AnchorProvider(base, unsigned, { commitment: "confirmed" }),
  );
  const tickets = (await (
    client.account["huntTicket" as keyof typeof client.account] as AccountClient
  ).all()) as {
    account: { settled: boolean; reserve: BN; authority: PublicKey; index: BN };
  }[];
  const house = await readHouse(unsigned);
  let reserved = 0;
  const active = [];
  for (const { account: ticket } of tickets) {
    if (ticket.settled) continue;
    reserved += ticket.reserve.toNumber();
    const wallet = { ...unsigned, publicKey: ticket.authority };
    const hunt = await readWager(wallet, ticket.index.toNumber());
    active.push({
      wallet: ticket.authority.toBase58(),
      hunt: hunt?.address.toBase58(),
      index: ticket.index.toNumber(),
      reservedCents: ticket.reserve.toNumber(),
      phase: hunt?.phase ?? "unavailable",
      rulesVersion: hunt?.rulesVersion,
      reveals: hunt?.revealCount,
      requestNonce: hunt?.requestNonce,
      requestedAt: hunt?.requestedAt,
      delegated: hunt?.delegated,
    });
  }
  console.log(
    JSON.stringify(
      {
        readOnly: true,
        cluster: "devnet",
        program: PROGRAM_ID.toBase58(),
        capturedAt: new Date().toISOString(),
        houseBalanceCents: house?.balance.toNumber(),
        houseReservedCents: house?.reserved.toNumber(),
        unsettledTicketReservesCents: reserved,
        active,
      },
      null,
      2,
    ),
  );
  if (!house || reserved !== house.reserved.toNumber())
    throw new Error(
      "Reservation totals did not reconcile; rerun without concurrent hunts before investigating",
    );
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
