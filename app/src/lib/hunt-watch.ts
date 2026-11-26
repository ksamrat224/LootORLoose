import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import { base, PROGRAM_ID, resolveEr, rpcDeadline } from "./chain";
import {
  decodeHuntAccount,
  readWager,
  wagerAddress,
  type Wager,
} from "./hunt-chain";

type Route = Awaited<ReturnType<typeof resolveEr>>;
/** Injectable transport keeps fallback/routing races testable without a live service. */
export type HuntWatchTransport = {
  route: typeof resolveEr;
  base: Connection;
  read: typeof readWager;
  decode: typeof decodeHuntAccount;
};
const defaultTransport: HuntWatchTransport = {
  route: resolveEr,
  base,
  read: readWager,
  decode: decodeHuntAccount,
};
export function watchHunt(
  wallet: AnchorWallet,
  index: number,
  onSnapshot: (state: Wager) => void,
  onError: (error: unknown) => void = () => {},
  transport = defaultTransport,
): () => void {
  let stopped = false,
    inFlight = false,
    generation = 0,
    listener: number | undefined;
  let connection: Connection | undefined,
    endpoint = "",
    route: Route | undefined;
  let newest = -1,
    slot = -1,
    fast = false,
    due = 0,
    subscribedNonce = -1;
  const address = wagerAddress(wallet.publicKey, index);
  const emit = (state: Wager) => {
    if (stopped || state.nonce < newest) return;
    newest = state.nonce;
    onSnapshot(state);
  };
  const unbind = () => {
    generation++;
    if (connection && listener !== undefined)
      void connection.removeAccountChangeListener(listener).catch(() => {});
    listener = undefined;
  };
  const tick = async () => {
    if (stopped || inFlight || Date.now() < due) return;
    inFlight = true;
    try {
      const nextRoute = await transport.route(address);
      if (stopped) return;
      const nextConnection = nextRoute.connection || transport.base;
      if (nextConnection.rpcEndpoint !== endpoint || listener === undefined) {
        unbind();
        route = nextRoute;
        connection = nextConnection;
        endpoint = connection.rpcEndpoint;
        slot = -1;
        const stamp = generation,
          capturedRoute = route;
        try {
          listener = connection.onAccountChange(
            address,
            (info, context) => {
              if (stopped || generation !== stamp || context.slot < slot)
                return;
              // Delegation/undelegation changes ownership. Re-resolve instead of decoding the lock.
              try {
                const state = transport.decode(
                  wallet,
                  index,
                  info,
                  capturedRoute,
                );
                slot = context.slot;
                subscribedNonce = state.nonce;
                fast = false;
                console.info("loot:hunt-update", {
                  source: "subscription",
                  index,
                  nonce: state.nonce,
                });
                emit(state);
              } catch {
                fast = true;
                due = 0;
              }
            },
            "confirmed",
          );
        } catch {
          fast = true;
        }
      }
      const stamp = generation;
      if (nextRoute.delegated) {
        const info = await rpcDeadline(
          nextConnection.getAccountInfo(address, "confirmed"),
        );
        if (stopped || generation !== stamp) return;
        if (info) {
          // During undelegation the previous endpoint can expose the delegation lock.
          if (!info.owner.equals(PROGRAM_ID)) {
            fast = true;
            due = Date.now() + 1500;
            return;
          }
          const state = transport.decode(wallet, index, info, nextRoute);
          if (
            newest >= 0 &&
            state.nonce > newest &&
            state.nonce > subscribedNonce
          )
            fast = true;
          emit(state);
        }
      } else {
        const state = await transport.read(wallet, index, true);
        if (!stopped && generation === stamp && state) emit(state);
      }
      due = Date.now() + (fast ? 1500 : 5000);
    } catch (error) {
      if (!stopped) {
        fast = true;
        due = Date.now() + 1500;
        onError(error);
      }
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, 250);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
    unbind();
  };
}
