use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use loot_or_lose::{
    accounts, instruction,
    wager::{
        payout, sample, DemoHouse, DemoPlayer, WagerPhase, WagerState, WagerTicket, HOUSE_SEED,
        ODDS, PLAYER_SEED, TICKET_SEED, WAGER_SEED,
    },
};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    data: impl InstructionData,
    accounts: impl ToAccountMetas,
) -> bool {
    svm.expire_blockhash();
    let ix = Instruction::new_with_bytes(
        loot_or_lose::id(),
        &data.data(),
        accounts.to_account_metas(None),
    );
    let message =
        Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    let result = svm.send_transaction(tx);
    if let Err(ref e) = result {
        eprintln!("Expected or actual rejection: {:?}", e.err);
    }
    result.is_ok()
}
fn read<T: AccountDeserialize>(svm: &LiteSVM, key: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&key).unwrap().data.as_slice()).unwrap()
}
fn fixture<T: AccountSerialize>(svm: &mut LiteSVM, key: Pubkey, value: &T) {
    let mut account = svm.get_account(&key).unwrap();
    value
        .try_serialize(&mut account.data.as_mut_slice())
        .unwrap();
    svm.set_account(key, account).unwrap();
}
struct Game {
    svm: LiteSVM,
    payer: Keypair,
    house: Pubkey,
    player: Pubkey,
    wager: Pubkey,
    ticket: Pubkey,
}
impl Game {
    fn new(stake: u64) -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program(
            loot_or_lose::id(),
            include_bytes!("../../../target/deploy/loot_or_lose.so"),
        )
        .unwrap();
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 2_000_000_000).unwrap();
        let pda = |seed: &[u8], player: bool, indexed: bool| {
            let authority = payer.pubkey();
            let index = 0u64.to_le_bytes();
            let seeds = if indexed {
                vec![seed, authority.as_ref(), &index]
            } else if player {
                vec![seed, authority.as_ref()]
            } else {
                vec![seed]
            };
            Pubkey::find_program_address(&seeds, &loot_or_lose::id()).0
        };
        let house = pda(HOUSE_SEED, false, false);
        let player = pda(PLAYER_SEED, true, false);
        let wager = pda(WAGER_SEED, true, true);
        let ticket = pda(TICKET_SEED, true, true);
        let system = anchor_lang::system_program::ID;
        assert!(send(
            &mut svm,
            &payer,
            instruction::InitializeHouse {},
            accounts::InitializeHouse {
                house,
                authority: payer.pubkey(),
                system_program: system
            }
        ));
        assert!(send(
            &mut svm,
            &payer,
            instruction::InitializeDemoPlayer {},
            accounts::InitializeDemoPlayer {
                player,
                authority: payer.pubkey(),
                system_program: system
            }
        ));
        let mut game = Self {
            svm,
            payer,
            house,
            player,
            wager,
            ticket,
        };
        assert!(game.create(0, stake));
        game
    }
    fn create(&mut self, index: u64, stake: u64) -> bool {
        let wager = Pubkey::find_program_address(
            &[
                WAGER_SEED,
                self.payer.pubkey().as_ref(),
                &index.to_le_bytes(),
            ],
            &loot_or_lose::id(),
        )
        .0;
        let ticket = Pubkey::find_program_address(
            &[
                TICKET_SEED,
                self.payer.pubkey().as_ref(),
                &index.to_le_bytes(),
            ],
            &loot_or_lose::id(),
        )
        .0;
        send(
            &mut self.svm,
            &self.payer,
            instruction::CreateWager { index, stake },
            accounts::CreateWager {
                house: self.house,
                player: self.player,
                ticket,
                wager,
                authority: self.payer.pubkey(),
                system_program: anchor_lang::system_program::ID,
            },
        )
    }
    fn state(&self) -> WagerState {
        read(&self.svm, self.wager)
    }
    fn update(&self) -> accounts::UpdateWager {
        accounts::UpdateWager {
            wager: self.wager,
            session_token: None,
            signer: self.payer.pubkey(),
        }
    }
    fn settle(&mut self) -> bool {
        send(
            &mut self.svm,
            &self.payer,
            instruction::SettleWager { index: 0 },
            accounts::SettleWager {
                house: self.house,
                player: self.player,
                ticket: self.ticket,
                wager: self.wager,
                authority: self.payer.pubkey(),
            },
        )
    }
    /// Controlled oracle fixture: disable cryptographic signature verification ONLY in LiteSVM.
    /// Anchor still validates the scoped identity, phase, index, nonce, and gate.
    fn callback(&mut self, seed: [u8; 32], nonce: u64, gate: u8, identity: Pubkey) -> bool {
        self.svm.expire_blockhash();
        let ix = Instruction::new_with_bytes(
            loot_or_lose::id(),
            &instruction::ResolveGate {
                randomness: seed,
                index: 0,
                request_nonce: nonce,
                gate,
            }
            .data(),
            accounts::ResolveGate {
                vrf_program_identity: identity,
                wager: self.wager,
            }
            .to_account_metas(None),
        );
        let message = Message::new_with_blockhash(
            &[ix],
            Some(&self.payer.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let signatures = vec![Default::default(); message.header.num_required_signatures as usize];
        let tx = VersionedTransaction {
            signatures,
            message: VersionedMessage::Legacy(message),
        };
        let mut svm = std::mem::take(&mut self.svm).with_sigverify(false);
        let result = svm.send_transaction(tx).is_ok();
        self.svm = svm.with_sigverify(true);
        result
    }
    fn pending(&mut self, gate: u8, nonce: u64) {
        let mut value = self.state();
        value.phase = WagerPhase::RandomnessPending;
        value.gate = gate;
        value.nonce = nonce;
        value.request_nonce = nonce;
        value.requested_at = 1;
        fixture(&mut self.svm, self.wager, &value);
    }
}
#[test]
fn stake_ledger_cancel_and_idempotent_settlement() {
    let mut g = Game::new(500);
    assert_eq!(read::<DemoPlayer>(&g.svm, g.player).balance, 9500);
    assert_eq!(read::<DemoHouse>(&g.svm, g.house).reserved, 1500);
    assert!(!g.create(1, 500));
    assert!(!g.settle());
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::CancelWager { index: 0 },
        accounts::CancelWager {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(g.settle());
    g.svm.expire_blockhash();
    assert!(g.settle());
    assert_eq!(read::<DemoPlayer>(&g.svm, g.player).balance, 10000);
    assert_eq!(read::<DemoHouse>(&g.svm, g.house).balance, 1_000_000);
    assert_eq!(read::<DemoHouse>(&g.svm, g.house).reserved, 0);
    assert!(read::<WagerTicket>(&g.svm, g.ticket).settled);
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::InitializeDemoPlayer {},
        accounts::InitializeDemoPlayer {
            player: g.player,
            authority: g.payer.pubkey(),
            system_program: anchor_lang::system_program::ID
        }
    ));
    assert!(g.create(1, 500));
}
#[test]
fn gate_callbacks_are_scoped_correlated_and_consumed_once() {
    let mut g = Game::new(501);
    g.pending(0, 1);
    let scoped = ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id());
    assert!(!g.callback([0; 32], 1, 0, g.payer.pubkey()));
    assert!(!g.callback([0; 32], 2, 0, scoped));
    assert!(!g.callback([0; 32], 1, 1, scoped));
    assert!(g.callback([0; 32], 1, 0, scoped));
    assert_eq!(g.state().gate, 1);
    assert!(!g.callback([0; 32], 1, 0, scoped));
    let update = g.update();
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::ExtractWager {
            index: 0,
            expected_nonce: 2
        },
        update
    ));
    assert_eq!(g.state().payout, 626);
    assert!(g.settle());
    assert_eq!(read::<DemoPlayer>(&g.svm, g.player).balance, 10125);
}
#[test]
fn loss_returns_zero_and_pending_requests_cannot_cancel_or_extract() {
    let mut g = Game::new(500);
    g.pending(0, 1);
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::CancelWager { index: 0 },
        accounts::CancelWager {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    let update = g.update();
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::ExtractWager {
            index: 0,
            expected_nonce: 1
        },
        update
    ));
    let mut seed = [0; 32];
    seed[0] = 24;
    assert!(sample(&seed, 25) >= 19);
    let scoped = ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id());
    assert!(g.callback(seed, 1, 0, scoped));
    assert_eq!(g.state().phase, WagerPhase::Lost);
    assert!(g.settle());
    assert_eq!(read::<DemoPlayer>(&g.svm, g.player).balance, 9500);
    assert_eq!(read::<DemoHouse>(&g.svm, g.house).reserved, 0);
}
#[test]
fn final_gate_freezes_three_x_and_every_strategy_has_exact_rtp() {
    let mut g = Game::new(500);
    let scoped = ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id());
    for gate in 0..3 {
        let nonce = gate as u64 * 2 + 1;
        g.pending(gate, nonce);
        assert!(g.callback([0; 32], nonce, gate, scoped));
    }
    assert_eq!(g.state().phase, WagerPhase::Extracting);
    assert_eq!(g.state().payout, 1500);
    assert!(g.settle());
    assert_eq!(read::<DemoPlayer>(&g.svm, g.player).balance, 11000);
    assert_eq!(payout(101, 1).unwrap(), 126);
    assert_eq!(payout(500, 2).unwrap(), 1000);
    // 19/25*5/4 = 19/20; continuing preserves the same expected value.
    let mut n = 1u64;
    let mut d = 1u64;
    for (i, (a, b)) in ODDS.iter().enumerate() {
        n *= a;
        d *= b;
        let (pn, pd) = [(5, 4), (2, 1), (3, 1)][i];
        assert_eq!(n * pn * 20, d * pd * 19);
    }
    assert!(sample(&[255; 32], 25) < 25); // Exercises rejection rehash, no biased fallback.
}
#[test]
fn movement_is_safe_and_rejects_walls_replays_and_other_owners() {
    let mut g = Game::new(200);
    let update = g.update();
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 0,
            path: vec![3]
        },
        update
    ));
    let update = g.update();
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 0,
            path: vec![1; 7]
        },
        update
    ));
    let update = g.update();
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 1,
            path: vec![2; 4]
        },
        update
    ));
    assert_eq!(g.state().phase, WagerPhase::Active);
    assert_eq!(g.state().stake, 200);
    assert_eq!((g.state().x, g.state().y), (8, 5));
    let update = g.update();
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 0,
            path: vec![1]
        },
        update
    ));
    let other = Keypair::new();
    g.svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    assert!(!send(
        &mut g.svm,
        &other,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 2,
            path: vec![1]
        },
        accounts::UpdateWager {
            wager: g.wager,
            session_token: None,
            signer: other.pubkey()
        }
    ));
}
#[test]
fn bankroll_reservations_and_player_balance_are_enforced() {
    let mut g = Game::new(500);
    // Mark the first run refundable and settle it through normal instructions.
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::CancelWager { index: 0 },
        accounts::CancelWager {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(g.settle());
    assert!(!g.create(1, 99));
    assert!(!g.create(1, 10001));
    let mut house: DemoHouse = read(&g.svm, g.house);
    house.balance = 500;
    house.reserved = 0;
    fixture(&mut g.svm, g.house, &house);
    assert!(!g.create(1, 500));
    let mut player: DemoPlayer = read(&g.svm, g.player);
    player.balance = 100;
    fixture(&mut g.svm, g.player, &player);
    assert!(!g.create(1, 200));
    assert_eq!(read::<DemoHouse>(&g.svm, g.house).reserved, 0);
}

#[test]
fn sessions_are_bound_to_one_run_and_cannot_settle_or_change_stakes() {
    let mut g = Game::new(200);
    let signer = Keypair::new();
    g.svm.airdrop(&signer.pubkey(), 1_000_000_000).unwrap();
    let (token, _) = Pubkey::find_program_address(
        &[
            b"session_token_v2",
            loot_or_lose::id().as_ref(),
            signer.pubkey().as_ref(),
            g.payer.pubkey().as_ref(),
        ],
        &session_keys::id(),
    );
    let mut value = session_keys::SessionTokenV2 {
        authority: g.payer.pubkey(),
        target_program: loot_or_lose::id(),
        session_signer: signer.pubkey(),
        fee_payer: g.payer.pubkey(),
        valid_until: i64::MAX,
    };
    let mut account = g.svm.get_account(&g.wager).unwrap();
    account.owner = session_keys::id();
    account.data = vec![];
    value.try_serialize(&mut account.data).unwrap();
    g.svm.set_account(token, account).unwrap();
    let update = || accounts::UpdateWager {
        wager: g.wager,
        session_token: Some(token),
        signer: signer.pubkey(),
    };
    assert!(!send(
        &mut g.svm,
        &signer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 0,
            path: vec![1]
        },
        update()
    ));
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::AuthorizeWagerSession {
            _index: 0,
            session_signer: signer.pubkey()
        },
        accounts::CancelWager {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(send(
        &mut g.svm,
        &signer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 0,
            path: vec![1]
        },
        update()
    ));
    assert!(!send(
        &mut g.svm,
        &signer,
        instruction::CancelWager { index: 0 },
        accounts::CancelWager {
            wager: g.wager,
            authority: signer.pubkey()
        }
    ));
    assert!(!send(
        &mut g.svm,
        &signer,
        instruction::AuthorizeWagerSession {
            _index: 0,
            session_signer: signer.pubkey()
        },
        accounts::CancelWager {
            wager: g.wager,
            authority: signer.pubkey()
        }
    ));
    value.valid_until = -1;
    fixture(&mut g.svm, token, &value);
    assert!(!send(
        &mut g.svm,
        &signer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 1,
            path: vec![1]
        },
        update()
    ));
    // Revocation closes the token account; even an unexpired signature cannot substitute for it.
    let mut closed = g.svm.get_account(&token).unwrap();
    closed.data = vec![];
    closed.owner = anchor_lang::system_program::ID;
    g.svm.set_account(token, closed).unwrap();
    assert!(!send(
        &mut g.svm,
        &signer,
        instruction::AdvanceWager {
            index: 0,
            expected_nonce: 1,
            path: vec![1]
        },
        update()
    ));
}

#[test]
fn multiple_wallets_reserve_independent_liabilities() {
    let mut g = Game::new(500);
    let other = Keypair::new();
    g.svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    let player =
        Pubkey::find_program_address(&[PLAYER_SEED, other.pubkey().as_ref()], &loot_or_lose::id())
            .0;
    let wager = Pubkey::find_program_address(
        &[WAGER_SEED, other.pubkey().as_ref(), &0u64.to_le_bytes()],
        &loot_or_lose::id(),
    )
    .0;
    let ticket = Pubkey::find_program_address(
        &[TICKET_SEED, other.pubkey().as_ref(), &0u64.to_le_bytes()],
        &loot_or_lose::id(),
    )
    .0;
    assert!(send(
        &mut g.svm,
        &other,
        instruction::InitializeDemoPlayer {},
        accounts::InitializeDemoPlayer {
            player,
            authority: other.pubkey(),
            system_program: anchor_lang::system_program::ID
        }
    ));
    assert!(send(
        &mut g.svm,
        &other,
        instruction::CreateWager {
            index: 0,
            stake: 1000
        },
        accounts::CreateWager {
            house: g.house,
            player,
            ticket,
            wager,
            authority: other.pubkey(),
            system_program: anchor_lang::system_program::ID
        }
    ));
    assert_eq!(read::<DemoHouse>(&g.svm, g.house).reserved, 4500);
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::CancelWager { index: 0 },
        accounts::CancelWager {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(g.settle());
    assert_eq!(read::<DemoHouse>(&g.svm, g.house).reserved, 3000);
    assert_eq!(read::<DemoPlayer>(&g.svm, player).balance, 9000);
}
