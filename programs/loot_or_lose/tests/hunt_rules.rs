use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use loot_or_lose::{
    accounts,
    hunt::{
        hunt_reward, HuntAttempt, HuntHouse, HuntPhase, HuntPlayer, HUNT_HOUSE_SEED,
        HUNT_PLAYER_SEED, HUNT_SEED, HUNT_TICKET_SEED,
    },
    instruction,
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
        let house = pda(HUNT_HOUSE_SEED, false, false);
        let player = pda(HUNT_PLAYER_SEED, true, false);
        let wager = pda(HUNT_SEED, true, true);
        let ticket = pda(HUNT_TICKET_SEED, true, true);
        let system = anchor_lang::system_program::ID;
        assert!(send(
            &mut svm,
            &payer,
            instruction::InitializeHuntHouse {},
            accounts::InitializeHuntHouse {
                house,
                authority: payer.pubkey(),
                system_program: system
            }
        ));
        assert!(send(
            &mut svm,
            &payer,
            instruction::InitializeHuntPlayer {},
            accounts::InitializeHuntPlayer {
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
                HUNT_SEED,
                self.payer.pubkey().as_ref(),
                &index.to_le_bytes(),
            ],
            &loot_or_lose::id(),
        )
        .0;
        let ticket = Pubkey::find_program_address(
            &[
                HUNT_TICKET_SEED,
                self.payer.pubkey().as_ref(),
                &index.to_le_bytes(),
            ],
            &loot_or_lose::id(),
        )
        .0;
        send(
            &mut self.svm,
            &self.payer,
            instruction::CreateHuntAttempt { index, stake },
            accounts::CreateHuntAttempt {
                house: self.house,
                player: self.player,
                ticket,
                wager,
                authority: self.payer.pubkey(),
                system_program: anchor_lang::system_program::ID,
            },
        )
    }
    fn state(&self) -> HuntAttempt {
        read(&self.svm, self.wager)
    }
    fn settle(&mut self) -> bool {
        send(
            &mut self.svm,
            &self.payer,
            instruction::SettleHuntAttempt { index: 0 },
            accounts::SettleHuntAttempt {
                house: self.house,
                player: self.player,
                ticket: self.ticket,
                wager: self.wager,
                authority: self.payer.pubkey(),
            },
        )
    }
    /// Controlled oracle fixture: disable cryptographic signature verification ONLY in LiteSVM.
    /// Anchor still validates the scoped identity, phase, index, nonce, and quest_id.
    fn callback(
        &mut self,
        seed: [u8; 32],
        nonce: u64,
        quest_id: u8,
        reveal_index: u8,
        identity: Pubkey,
    ) -> bool {
        self.svm.expire_blockhash();
        let ix = Instruction::new_with_bytes(
            loot_or_lose::id(),
            &instruction::ResolveHunt {
                randomness: seed,
                index: 0,
                request_nonce: nonce,
                quest_id,
                reveal_index,
            }
            .data(),
            accounts::ResolveHunt {
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
    fn pending(&mut self, quest_id: u8) {
        let mut value = self.state();
        let path = path_from((value.x, value.y), quest_id);
        let nonce = value.nonce;
        loot_or_lose::hunt::prepare_hunt_reveal(&mut value, nonce, quest_id, &path, 1).unwrap();
        fixture(&mut self.svm, self.wager, &value);
    }
    fn cancel(&mut self) -> bool {
        send(
            &mut self.svm,
            &self.payer,
            instruction::CancelHuntAttempt { index: 0 },
            accounts::CancelHuntAttempt {
                wager: self.wager,
                authority: self.payer.pubkey(),
            },
        )
    }
}
fn path_from(start: (u8, u8), id: u8) -> Vec<u8> {
    let mut queue = std::collections::VecDeque::from([(start, vec![])]);
    let mut seen = std::collections::HashSet::from([start]);
    let target = loot_or_lose::hunt::HUNT_QUESTS[id as usize];
    while let Some(((x, y), path)) = queue.pop_front() {
        if x.abs_diff(target.0) + y.abs_diff(target.1) <= 1 {
            return path;
        }
        for (dir, (dx, dy)) in [(0, -1), (1, 0), (0, 1), (-1, 0)].iter().enumerate() {
            let (nx, ny) = (x as i16 + dx, y as i16 + dy);
            if (0..16).contains(&nx)
                && (0..10).contains(&ny)
                && loot_or_lose::MAP[ny as usize][nx as usize] == b'.'
                && seen.insert((nx as u8, ny as u8))
            {
                let mut next = path.clone();
                next.push(dir as u8);
                queue.push_back(((nx as u8, ny as u8), next));
            }
        }
    }
    panic!("No path")
}
fn seed(bucket: u8) -> [u8; 32] {
    let mut bytes = [0; 32];
    bytes[0] = bucket;
    bytes
}
fn scoped() -> Pubkey {
    ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id())
}
#[test]
fn all_ordered_three_quest_choices_preserve_loot_and_settle_once() {
    // 120 ordered choices covers every first quest and all 20 combinations.
    for a in 0..6 {
        for b in 0..6 {
            for c in 0..6 {
                if a == b || a == c || b == c {
                    continue;
                }
                let mut g = Game::new(501);
                assert_eq!(read::<HuntHouse>(&g.svm, g.house).reserved, 2505);
                assert!(!g.create(1, 200));
                for (i, id) in [a, b, c].iter().enumerate() {
                    g.pending(*id);
                    let nonce = g.state().request_nonce;
                    assert!(!g.cancel());
                    assert!(!g.settle());
                    assert!(g.callback(seed([40, 0, 99][i]), nonce, *id, i as u8, scoped()));
                    assert!(!g.callback(seed(99), nonce, *id, i as u8, scoped()));
                    assert_eq!(g.state().reveal_count, i as u8 + 1);
                    assert_eq!(g.state().payout, [125, 125, 960][i]);
                    assert!(!g.cancel());
                    let mut state = g.state();
                    let n = state.nonce;
                    assert!(
                        loot_or_lose::hunt::prepare_hunt_reveal(&mut state, n, *id, &[], 1)
                            .is_err()
                    );
                }
                assert_eq!(g.state().phase, HuntPhase::Complete);
                assert!(g.settle());
                assert!(g.settle());
                assert_eq!(read::<HuntPlayer>(&g.svm, g.player).balance, 10459);
                assert_eq!(read::<HuntHouse>(&g.svm, g.house).reserved, 0);
            }
        }
    }
}
#[test]
fn exact_buckets_rounding_reserves_and_expected_return() {
    for (bucket, n, d) in [
        (0, 0, 1),
        (39, 0, 1),
        (40, 1, 4),
        (69, 1, 4),
        (70, 1, 2),
        (89, 1, 2),
        (90, 1, 1),
        (97, 1, 1),
        (98, 5, 3),
        (99, 5, 3),
    ] {
        assert_eq!(hunt_reward(101, bucket).unwrap(), 101 * n / d);
    }
    assert!(hunt_reward(200, 100).is_err());
    assert_eq!(loot_or_lose::hunt::hunt_reserve(101).unwrap(), 504);
    assert_eq!(
        (0..100).map(|b| hunt_reward(1200, b).unwrap()).sum::<u64>() * 3 * 2,
        1200 * 173
    );
}
#[test]
fn callback_identity_reveal_index_quest_nonce_and_pending_lock() {
    let mut g = Game::new(200);
    g.pending(5);
    assert!(!g.callback(seed(99), 1, 5, 0, g.payer.pubkey()));
    assert!(!g.callback(seed(99), 2, 5, 0, scoped()));
    assert!(!g.callback(seed(99), 1, 4, 0, scoped()));
    assert!(!g.callback(seed(99), 1, 5, 1, scoped()));
    let mut state = g.state();
    assert!(loot_or_lose::hunt::prepare_hunt_reveal(&mut state, 1, 0, &[], 1).is_err());
    assert!(g.callback(seed(99), 1, 5, 0, scoped()));
    assert_eq!(g.state().payout, 333);
    assert!(!g.callback(seed(99), 1, 5, 0, scoped()));
}
#[test]
fn cancellation_and_zero_hunts_credit_exactly_once() {
    let mut g = Game::new(200);
    assert!(g.cancel());
    assert!(g.settle());
    assert!(g.settle());
    assert_eq!(read::<HuntPlayer>(&g.svm, g.player).balance, 10000);
    let mut g = Game::new(200);
    for (i, id) in [0, 2, 4].iter().enumerate() {
        g.pending(*id);
        let n = g.state().request_nonce;
        assert!(g.callback(seed(0), n, *id, i as u8, scoped()));
    }
    assert!(g.settle());
    assert_eq!(read::<HuntPlayer>(&g.svm, g.player).balance, 9800);
}
#[test]
fn paths_reservations_and_tampered_rewards_are_rejected() {
    use loot_or_lose::hunt::{hunt_approach, prepare_hunt_reveal};
    assert!(hunt_approach((1, 1), 0, &[1; 65]).is_err());
    assert!(hunt_approach((1, 1), 0, &[3]).is_err());
    assert!(hunt_approach((1, 1), 0, &[9]).is_err());
    assert!(hunt_approach((1, 1), 0, &[]).is_err());
    assert!(hunt_approach((1, 1), 6, &[]).is_err());
    let mut g = Game::new(200);
    let mut v = g.state();
    assert!(prepare_hunt_reveal(&mut v, 9, 0, &[], 1).is_err());
    assert!(g.cancel());
    assert!(g.settle());
    assert!(!g.create(1, 99));
    assert!(!g.create(1, 10001));
    let mut house: HuntHouse = read(&g.svm, g.house);
    house.balance = 100;
    fixture(&mut g.svm, g.house, &house);
    assert!(!g.create(1, 200));
    let mut g = Game::new(200);
    for (i, id) in [0, 1, 2].iter().enumerate() {
        g.pending(*id);
        let n = g.state().request_nonce;
        assert!(g.callback(seed(90), n, *id, i as u8, scoped()));
    }
    let mut v = g.state();
    v.reveals[0].reward = 999;
    fixture(&mut g.svm, g.wager, &v);
    assert!(!g.settle());
}
#[test]
fn hunt_session_is_wallet_bound_and_has_no_ledger_authority() {
    let mut g = Game::new(500);
    let other = Keypair::new();
    g.svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    assert!(!send(
        &mut g.svm,
        &other,
        instruction::AuthorizeHuntSession {
            _index: 0,
            session_signer: other.pubkey()
        },
        accounts::CancelHuntAttempt {
            wager: g.wager,
            authority: other.pubkey()
        }
    ));
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::AuthorizeHuntSession {
            _index: 0,
            session_signer: other.pubkey()
        },
        accounts::CancelHuntAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert_eq!(g.state().session_signer, other.pubkey());
    assert!(!send(
        &mut g.svm,
        &other,
        instruction::CancelHuntAttempt { index: 0 },
        accounts::CancelHuntAttempt {
            wager: g.wager,
            authority: other.pubkey()
        }
    ));
    assert!(!send(
        &mut g.svm,
        &other,
        instruction::SettleHuntAttempt { index: 0 },
        accounts::SettleHuntAttempt {
            wager: g.wager,
            house: g.house,
            player: g.player,
            ticket: g.ticket,
            authority: other.pubkey()
        }
    ));
    assert_eq!(read::<HuntPlayer>(&g.svm, g.player).balance, 9500);
    // A terminal attempt cannot authorize a new signer.
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::CancelHuntAttempt { index: 0 },
        accounts::CancelHuntAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::AuthorizeHuntSession {
            _index: 0,
            session_signer: other.pubkey()
        },
        accounts::CancelHuntAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
}

fn hunt_session_risk(g: &mut Game, signer: &Keypair, token: Pubkey) -> String {
    use ephemeral_rollups_sdk::vrf::consts::{DEFAULT_QUEUE, VRF_PROGRAM_ID};
    let identity = Pubkey::find_program_address(&[b"identity"], &loot_or_lose::id()).0;
    let dummy = g.svm.get_account(&anchor_lang::system_program::ID).unwrap();
    g.svm.set_account(VRF_PROGRAM_ID, dummy.clone()).unwrap();
    let mut ordinary = dummy;
    ordinary.executable = false;
    ordinary.owner = anchor_lang::system_program::ID;
    ordinary.data = vec![];
    g.svm.set_account(identity, ordinary.clone()).unwrap();
    g.svm.set_account(DEFAULT_QUEUE, ordinary).unwrap();
    g.svm.expire_blockhash();
    let ix = Instruction::new_with_bytes(
        loot_or_lose::id(),
        &instruction::RiskHunt {
            index: 0,
            expected_nonce: 0,
            quest_id: 0,
            approach_path: path_from((1, 1), 0),
        }
        .data(),
        accounts::RiskHunt {
            wager: g.wager,
            session_token: Some(token),
            signer: signer.pubkey(),
            oracle_queue: DEFAULT_QUEUE,
            program_identity: identity,
            vrf_program: VRF_PROGRAM_ID,
            slot_hashes: "SysvarS1otHashes111111111111111111111111111"
                .parse()
                .unwrap(),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
    );
    let message =
        Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &g.svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[signer]).unwrap();
    format!("{:?}", g.svm.send_transaction(tx))
}
#[test]
fn expired_and_revoked_hunt_sessions_cannot_request_randomness() {
    let mut g = Game::new(500);
    let signer = Keypair::new();
    g.svm.airdrop(&signer.pubkey(), 1_000_000_000).unwrap();
    let token = Pubkey::find_program_address(
        &[
            b"session_token_v2",
            loot_or_lose::id().as_ref(),
            signer.pubkey().as_ref(),
            g.payer.pubkey().as_ref(),
        ],
        &session_keys::id(),
    )
    .0;
    let value = session_keys::SessionTokenV2 {
        authority: g.payer.pubkey(),
        target_program: loot_or_lose::id(),
        session_signer: signer.pubkey(),
        fee_payer: g.payer.pubkey(),
        valid_until: -1,
    };
    let mut account = g.svm.get_account(&g.wager).unwrap();
    account.owner = session_keys::id();
    account.data = vec![];
    value.try_serialize(&mut account.data).unwrap();
    g.svm.set_account(token, account).unwrap();
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::AuthorizeHuntSession {
            _index: 0,
            session_signer: signer.pubkey()
        },
        accounts::CancelHuntAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    let rejected = hunt_session_risk(&mut g, &signer, token);
    assert!(rejected.contains("InvalidToken"), "{rejected}");
    assert_eq!(g.state().phase, HuntPhase::Active);
    assert_eq!(g.state().nonce, 0);
    let mut closed = g.svm.get_account(&token).unwrap();
    closed.owner = anchor_lang::system_program::ID;
    closed.data = vec![];
    g.svm.set_account(token, closed).unwrap();
    let rejected = hunt_session_risk(&mut g, &signer, token);
    assert!(rejected.contains("Err("), "{rejected}");
    assert_eq!(g.state().nonce, 0);
}
