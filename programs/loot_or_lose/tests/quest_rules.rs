use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{
    prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use loot_or_lose::wager::sample;
use loot_or_lose::{
    accounts, instruction,
    quest::{
        quest_payout, QuestAttempt, QuestHouse, QuestPhase, QuestPlayer, QuestTicket, ATTEMPT_SEED,
        QUEST_HOUSE_SEED, QUEST_ODDS, QUEST_PLAYER_SEED, QUEST_TICKET_SEED,
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
    quest_id: u8,
}
impl Game {
    fn new(quest_id: u8, stake: u64) -> Self {
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
        let house = pda(QUEST_HOUSE_SEED, false, false);
        let player = pda(QUEST_PLAYER_SEED, true, false);
        let wager = pda(ATTEMPT_SEED, true, true);
        let ticket = pda(QUEST_TICKET_SEED, true, true);
        let system = anchor_lang::system_program::ID;
        assert!(send(
            &mut svm,
            &payer,
            instruction::InitializeQuestHouse {},
            accounts::InitializeQuestHouse {
                house,
                authority: payer.pubkey(),
                system_program: system
            }
        ));
        assert!(send(
            &mut svm,
            &payer,
            instruction::InitializeQuestPlayer {},
            accounts::InitializeQuestPlayer {
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
            quest_id,
        };
        assert!(game.create(0, stake));
        game
    }
    fn create(&mut self, index: u64, stake: u64) -> bool {
        let wager = Pubkey::find_program_address(
            &[
                ATTEMPT_SEED,
                self.payer.pubkey().as_ref(),
                &index.to_le_bytes(),
            ],
            &loot_or_lose::id(),
        )
        .0;
        let ticket = Pubkey::find_program_address(
            &[
                QUEST_TICKET_SEED,
                self.payer.pubkey().as_ref(),
                &index.to_le_bytes(),
            ],
            &loot_or_lose::id(),
        )
        .0;
        send(
            &mut self.svm,
            &self.payer,
            instruction::CreateQuestAttempt {
                index,
                stake,
                quest_id: self.quest_id,
                approach_path: path(self.quest_id),
            },
            accounts::CreateQuestAttempt {
                house: self.house,
                player: self.player,
                ticket,
                wager,
                authority: self.payer.pubkey(),
                system_program: anchor_lang::system_program::ID,
            },
        )
    }
    fn state(&self) -> QuestAttempt {
        read(&self.svm, self.wager)
    }
    fn settle(&mut self) -> bool {
        send(
            &mut self.svm,
            &self.payer,
            instruction::SettleQuestAttempt { index: 0 },
            accounts::SettleQuestAttempt {
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
    fn callback(&mut self, seed: [u8; 32], nonce: u64, quest_id: u8, identity: Pubkey) -> bool {
        self.svm.expire_blockhash();
        let ix = Instruction::new_with_bytes(
            loot_or_lose::id(),
            &instruction::ResolveQuest {
                randomness: seed,
                index: 0,
                request_nonce: nonce,
                quest_id,
            }
            .data(),
            accounts::ResolveQuest {
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
    fn pending(&mut self, quest_id: u8, nonce: u64) {
        let mut value = self.state();
        value.phase = QuestPhase::RandomnessPending;
        value.quest_id = quest_id;
        value.nonce = nonce;
        value.request_nonce = nonce;
        value.requested_at = 1;
        fixture(&mut self.svm, self.wager, &value);
    }
}

fn path(id: u8) -> Vec<u8> {
    match id {
        0 => vec![1; 3],
        1 => [vec![2; 6], vec![1; 1]].concat(),
        2 => [vec![2; 6], vec![1; 6]].concat(),
        3 => vec![1; 7],
        4 => vec![1; 11],
        5 => [vec![1; 11], vec![2; 5]].concat(),
        _ => vec![],
    }
}
#[test]
fn every_quest_is_independent_reserves_exact_return_and_settles_once() {
    let scoped = ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id());
    for id in 0..6 {
        let mut g = Game::new(id, 501);
        let expected = quest_payout(501, id).unwrap();
        assert_eq!(read::<QuestHouse>(&g.svm, g.house).reserved, expected);
        assert_eq!(g.state().quest_id, id);
        assert!(!g.create(1, 200));
        g.pending(id, 1);
        assert!(g.callback([0; 32], 1, id, scoped));
        assert_eq!(g.state().phase, QuestPhase::Succeeded);
        assert_eq!(g.state().payout, expected);
        assert!(!g.callback([0; 32], 1, id, scoped));
        assert!(g.settle());
        assert!(g.settle());
        assert_eq!(
            read::<QuestPlayer>(&g.svm, g.player).balance,
            9499 + expected
        );
        assert_eq!(read::<QuestHouse>(&g.svm, g.house).reserved, 0);
        assert_eq!(read::<QuestTicket>(&g.svm, g.ticket).quest_id, id);
    }
}
#[test]
fn all_quests_have_exact_95_percent_rtp_and_validated_approaches() {
    for (id, (n, d)) in QUEST_ODDS.iter().enumerate() {
        let payout = quest_payout(10000, id as u8).unwrap();
        assert_eq!(n * payout * 20, d * 10000 * 19);
        assert!(loot_or_lose::quest::approach(id as u8, &path(id as u8)).is_ok());
    }
    assert!(loot_or_lose::quest::approach(6, &[]).is_err());
    assert!(loot_or_lose::quest::approach(0, &[]).is_err());
    assert!(loot_or_lose::quest::approach(0, &[3]).is_err());
    assert!(loot_or_lose::quest::approach(0, &[9]).is_err());
    assert!(loot_or_lose::quest::approach(0, &[1; 65]).is_err());
    assert_eq!(quest_payout(101, 0).unwrap(), 126);
    assert_eq!(quest_payout(101, 1).unwrap(), 151);
}
#[test]
fn callback_identity_quest_nonce_and_ticket_binding_cannot_be_forged() {
    let mut g = Game::new(5, 500);
    g.pending(5, 1);
    let scoped = ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id());
    assert!(!g.callback([0; 32], 1, 5, g.payer.pubkey()));
    assert!(!g.callback([0; 32], 2, 5, scoped));
    assert!(!g.callback([0; 32], 1, 0, scoped));
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::CancelQuestAttempt { index: 0 },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(g.callback([0; 32], 1, 5, scoped));
    let mut ticket: QuestTicket = read(&g.svm, g.ticket);
    ticket.quest_id = 0;
    fixture(&mut g.svm, g.ticket, &ticket);
    assert!(!g.settle());
}
#[test]
fn failure_settles_zero_for_each_quest_and_cancellation_refunds_any_quest() {
    let scoped = ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id());
    for id in 0..6 {
        let mut g = Game::new(id, 500);
        assert!(send(
            &mut g.svm,
            &g.payer,
            instruction::CancelQuestAttempt { index: 0 },
            accounts::CancelQuestAttempt {
                wager: g.wager,
                authority: g.payer.pubkey()
            }
        ));
        assert!(g.settle());
        assert_eq!(read::<QuestPlayer>(&g.svm, g.player).balance, 10000);
        let mut g = Game::new(id, 500);
        g.pending(id, 1);
        let mut seed = [0; 32];
        seed[0] = 24;
        assert!(sample(&seed, QUEST_ODDS[id as usize].1) >= 19);
        assert!(g.callback(seed, 1, id, scoped));
        assert_eq!(g.state().phase, QuestPhase::Lost);
        assert!(g.settle());
        assert_eq!(read::<QuestPlayer>(&g.svm, g.player).balance, 9500);
        assert_eq!(read::<QuestHouse>(&g.svm, g.house).reserved, 0);
    }
}
#[test]
fn invalid_reservations_and_insufficient_balances_fail_atomically() {
    let mut g = Game::new(5, 500);
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::CancelQuestAttempt { index: 0 },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(g.settle());
    assert!(!g.create(1, 99));
    assert!(!g.create(1, 10001));
    let mut house: QuestHouse = read(&g.svm, g.house);
    house.balance = 500;
    fixture(&mut g.svm, g.house, &house);
    assert!(!g.create(1, 500));
    assert_eq!(read::<QuestPlayer>(&g.svm, g.player).balance, 10000);
    house.balance = 1_000_000;
    fixture(&mut g.svm, g.house, &house);
    let mut player: QuestPlayer = read(&g.svm, g.player);
    player.balance = 100;
    fixture(&mut g.svm, g.player, &player);
    assert!(!g.create(1, 500));
    assert_eq!(read::<QuestHouse>(&g.svm, g.house).reserved, 0);
}

#[test]
fn quest_session_is_wallet_bound_and_has_no_ledger_authority() {
    let mut g = Game::new(3, 500);
    let other = Keypair::new();
    g.svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    assert!(!send(
        &mut g.svm,
        &other,
        instruction::AuthorizeQuestSession {
            _index: 0,
            session_signer: other.pubkey()
        },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: other.pubkey()
        }
    ));
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::AuthorizeQuestSession {
            _index: 0,
            session_signer: other.pubkey()
        },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert_eq!(g.state().session_signer, other.pubkey());
    assert!(!send(
        &mut g.svm,
        &other,
        instruction::CancelQuestAttempt { index: 0 },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: other.pubkey()
        }
    ));
    assert!(!send(
        &mut g.svm,
        &other,
        instruction::SettleQuestAttempt { index: 0 },
        accounts::SettleQuestAttempt {
            wager: g.wager,
            house: g.house,
            player: g.player,
            ticket: g.ticket,
            authority: other.pubkey()
        }
    ));
    assert_eq!(read::<QuestPlayer>(&g.svm, g.player).balance, 9500);
    // A terminal attempt cannot authorize a new signer.
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::CancelQuestAttempt { index: 0 },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(!send(
        &mut g.svm,
        &g.payer,
        instruction::AuthorizeQuestSession {
            _index: 0,
            session_signer: other.pubkey()
        },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
}

fn session_risk(g: &mut Game, signer: &Keypair, token: Pubkey) -> String {
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
        &instruction::RiskQuest {
            index: 0,
            expected_nonce: 0,
            quest_id: 0,
            approach_path: path(0),
        }
        .data(),
        accounts::RiskQuest {
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
fn expired_and_revoked_quest_sessions_cannot_request_randomness() {
    let mut g = Game::new(0, 500);
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
        instruction::AuthorizeQuestSession {
            _index: 0,
            session_signer: signer.pubkey()
        },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    let rejected = session_risk(&mut g, &signer, token);
    assert!(rejected.contains("InvalidToken"), "{rejected}");
    assert_eq!(g.state().phase, QuestPhase::Active);
    assert_eq!(g.state().nonce, 0);
    let mut closed = g.svm.get_account(&token).unwrap();
    closed.owner = anchor_lang::system_program::ID;
    closed.data = vec![];
    g.svm.set_account(token, closed).unwrap();
    let rejected = session_risk(&mut g, &signer, token);
    assert!(rejected.contains("Err("), "{rejected}");
    assert_eq!(g.state().nonce, 0);
}

#[test]
fn stake_at_spawn_can_fund_any_later_quest_and_reserves_the_maximum() {
    let scoped = ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity(&loot_or_lose::id());
    for id in 0..6 {
        let mut g = Game::new(255, 500);
        assert_eq!(g.state().quest_id, 255);
        assert_eq!((g.state().x, g.state().y), (1, 1));
        assert_eq!(read::<QuestHouse>(&g.svm, g.house).reserved, 2500);
        // The request binds the runtime quest while the immutable ticket remains unchosen.
        g.pending(id, 1);
        assert!(g.callback([0; 32], 1, id, scoped));
        assert!(g.settle());
        assert_eq!(
            read::<QuestPlayer>(&g.svm, g.player).balance,
            9500 + quest_payout(500, id).unwrap()
        );
        assert_eq!(read::<QuestHouse>(&g.svm, g.house).reserved, 0);
        assert_eq!(read::<QuestTicket>(&g.svm, g.ticket).quest_id, 255);
    }
    let mut g = Game::new(255, 500);
    assert!(send(
        &mut g.svm,
        &g.payer,
        instruction::CancelQuestAttempt { index: 0 },
        accounts::CancelQuestAttempt {
            wager: g.wager,
            authority: g.payer.pubkey()
        }
    ));
    assert!(g.settle());
    assert_eq!(read::<QuestPlayer>(&g.svm, g.player).balance, 10000);
}
