import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { ConnectionMagicRouter, GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram, Transaction, type TransactionSignature } from "@solana/web3.js";
import idl from "./loot_or_lose.json";

export const BASE_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://rpc.magicblock.app/devnet";
export const ROUTER_URL = process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL || "https://devnet-router.magicblock.app/";
export const PROGRAM_ID = new PublicKey(idl.address);
export const DEPLOYED_ID = process.env.NEXT_PUBLIC_GAME_PROGRAM_ID;
export const isConfigured = Boolean(DEPLOYED_ID && DEPLOYED_ID === PROGRAM_ID.toBase58());
export const base = new Connection(BASE_URL, "confirmed");
export const router = new ConnectionMagicRouter(ROUTER_URL, "confirmed");

export type ChainPhase = "created" | "active" | "extracting" | "extracted" | "dead" | "timedOut";
export type ChainRun = { authority: PublicKey; index: BN; phase: Record<ChainPhase, object>; x: number; y: number; hp: number; deadline: BN; chestMask: number; pending: number[]; nonce: BN; finalScore: number };
export type ChainProfile = { authority: PublicKey; nextRunIndex: BN };
export type RunSnapshot = { address: PublicKey; index: number; phase: ChainPhase; x: number; y: number; hp: number; deadline: number; chestMask: number; nonce: number; finalScore: number; source: "base" | "er"; endpoint?: string; delegated: boolean };

function provider(connection: Connection, wallet: AnchorWallet) {
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}
function program(connection: Connection, wallet: AnchorWallet) {
  return new Program(idl as Idl, provider(connection, wallet));
}
function ensureConfigured() {
  if (!isConfigured) throw new Error("Deploy this program to devnet and set NEXT_PUBLIC_GAME_PROGRAM_ID to the deployed address before starting an onchain run.");
}
export function profileAddress(authority: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("profile"), authority.toBuffer()], PROGRAM_ID)[0];
}
export function runAddress(authority: PublicKey, index: number) {
  return PublicKey.findProgramAddressSync([Buffer.from("run"), authority.toBuffer(), new BN(index).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
}
async function readAccount<T>(connection: Connection, wallet: AnchorWallet, address: PublicKey, name: string): Promise<T | null> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(PROGRAM_ID)) return null;
  return program(connection, wallet).coder.accounts.decode(name, info.data) as T;
}
async function submit(connection: Connection, wallet: AnchorWallet, transaction: Transaction): Promise<TransactionSignature> {
  transaction.feePayer = wallet.publicKey;
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latest.blockhash;
  const signed = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (confirmation.value.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}
export async function createRun(wallet: AnchorWallet): Promise<{ index: number; address: PublicKey; signatures: string[] }> {
  ensureConfigured();
  const authority = wallet.publicKey;
  const profile = profileAddress(authority);
  const client = program(base, wallet);
  const signatures: string[] = [];
  let record = await readAccount<ChainProfile>(base, wallet, profile, "playerProfile");
  if (!record) {
    signatures.push(await submit(base, wallet, await client.methods.initializeProfile().accountsPartial({ profile, authority, systemProgram: SystemProgram.programId }).transaction()));
    record = await readAccount<ChainProfile>(base, wallet, profile, "playerProfile");
  }
  if (!record) throw new Error("Profile was not found after creation. Refresh before retrying.");
  const index = record.nextRunIndex.toNumber();
  const address = runAddress(authority, index);
  signatures.push(await submit(base, wallet, await client.methods.createRun(new BN(index)).accountsPartial({ profile, run: address, authority, systemProgram: SystemProgram.programId }).transaction()));
  return { index, address, signatures };
}
export async function delegateRun(wallet: AnchorWallet, index: number): Promise<string> {
  ensureConfigured();
  const client = program(base, wallet);
  const run = runAddress(wallet.publicKey, index);
  return submit(base, wallet, await client.methods.delegateRun(new BN(index)).accountsPartial({ authority: wallet.publicKey, run }).transaction());
}
export async function resolveEr(address: PublicKey): Promise<{ delegated: boolean; endpoint?: string; connection?: Connection }> {
  const status = await router.getDelegationStatus(address) as { isDelegated: boolean; fqdn?: string };
  if (!status.isDelegated) return { delegated: false };
  if (!status.fqdn) throw new Error("Router confirms delegation but has not returned an ER endpoint yet. Retry status shortly.");
  const endpoint = status.fqdn.startsWith("http") ? status.fqdn : `https://${status.fqdn}`;
  return { delegated: true, endpoint, connection: new Connection(endpoint, "confirmed") };
}
export async function readRun(wallet: AnchorWallet, index: number): Promise<RunSnapshot | null> {
  const address = runAddress(wallet.publicKey, index);
  const route = await resolveEr(address);
  const connection = route.connection || base;
  const state = await readAccount<ChainRun>(connection, wallet, address, "runState");
  if (!state) return null;
  const phase = Object.keys(state.phase)[0] as ChainPhase;
  return { address, index, phase, x: state.x, y: state.y, hp: state.hp, deadline: state.deadline.toNumber(), chestMask: state.chestMask, nonce: state.nonce.toNumber(), finalScore: state.finalScore, source: route.delegated ? "er" : "base", endpoint: route.endpoint, delegated: route.delegated };
}
export async function findLatestRun(wallet: AnchorWallet): Promise<RunSnapshot | null> {
  const profile = await readAccount<ChainProfile>(base, wallet, profileAddress(wallet.publicKey), "playerProfile");
  if (!profile || profile.nextRunIndex.isZero()) return null;
  return readRun(wallet, profile.nextRunIndex.subn(1).toNumber());
}
async function submitEr(wallet: AnchorWallet, index: number, build: (client: Program<Idl>, run: PublicKey) => Promise<Transaction>): Promise<string> {
  const address = runAddress(wallet.publicKey, index);
  const route = await resolveEr(address);
  if (!route.connection) throw new Error("Run is not delegated to an Ephemeral Rollup.");
  return submit(route.connection, wallet, await build(program(route.connection, wallet), address));
}
export async function activateRun(wallet: AnchorWallet, index: number) {
  return submitEr(wallet, index, (client, run) => client.methods.activateRun(new BN(index)).accountsPartial({ run, authority: wallet.publicKey }).transaction());
}
export async function advanceRun(wallet: AnchorWallet, state: RunSnapshot, path: number[]) {
  return submitEr(wallet, state.index, (client, run) => client.methods.advance(new BN(state.index), new BN(state.nonce), Buffer.from(path)).accountsPartial({ run, authority: wallet.publicKey }).transaction());
}
export async function openChest(wallet: AnchorWallet, state: RunSnapshot, chestId: number) {
  return submitEr(wallet, state.index, (client, run) => client.methods.openChest(new BN(state.index), new BN(state.nonce), chestId).accountsPartial({ run, authority: wallet.publicKey }).transaction());
}
export async function requestExtraction(wallet: AnchorWallet, state: RunSnapshot) {
  return submitEr(wallet, state.index, (client, run) => client.methods.requestExtraction(new BN(state.index), new BN(state.nonce)).accountsPartial({ run, authority: wallet.publicKey }).transaction());
}
export async function expireRun(wallet: AnchorWallet, index: number) {
  return submitEr(wallet, index, (client, run) => client.methods.expireRun(new BN(index)).accountsPartial({ run }).transaction());
}
export async function finalizeRun(wallet: AnchorWallet, index: number): Promise<{ erSignature: string; commitSignature?: string }> {
  const address = runAddress(wallet.publicKey, index);
  const route = await resolveEr(address);
  if (!route.connection) throw new Error("Run is not delegated. Read its base-layer receipt before retrying finalization.");
  const client = program(route.connection, wallet);
  const transaction = await client.methods.finalizeRun(new BN(index)).accountsPartial({ authority: wallet.publicKey, run: address }).transaction();
  const erSignature = await submit(route.connection, wallet, transaction);
  let commitSignature: string | undefined;
  try { commitSignature = await GetCommitmentSignature(erSignature, route.connection); } catch { /* Base read remains authoritative. */ }
  return { erSignature, commitSignature };
}
export async function readBaseReceipt(wallet: AnchorWallet, index: number): Promise<RunSnapshot | null> {
  const address = runAddress(wallet.publicKey, index);
  const state = await readAccount<ChainRun>(base, wallet, address, "runState");
  if (!state) return null;
  const phase = Object.keys(state.phase)[0] as ChainPhase;
  return { address, index, phase, x: state.x, y: state.y, hp: state.hp, deadline: state.deadline.toNumber(), chestMask: state.chestMask, nonce: state.nonce.toNumber(), finalScore: state.finalScore, source: "base", delegated: false };
}
