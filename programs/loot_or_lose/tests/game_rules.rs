use anchor_lang::prelude::Clock;
use anchor_lang::{
    prelude::Pubkey, solana_program::instruction::Instruction, AccountDeserialize, InstructionData,
    ToAccountMetas,
};
use litesvm::LiteSVM;
use loot_or_lose::{accounts, instruction, Phase, RunState, PROFILE_SEED, RUN_SEED};
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    data: impl InstructionData,
    metas: &impl ToAccountMetas,
) -> bool {
    let instruction = Instruction::new_with_bytes(
        loot_or_lose::id(),
        &data.data(),
        metas.to_account_metas(None),
    );
    let message = Message::new_with_blockhash(
        &[instruction],
        Some(&payer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    svm.send_transaction(tx).is_ok()
}

fn run_state(svm: &LiteSVM, key: &Pubkey) -> RunState {
    let account = svm.get_account(key).unwrap();
    RunState::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn checkpoints_chests_and_extraction_are_validated() {
    let mut svm = LiteSVM::new();
    svm.add_program(
        loot_or_lose::id(),
        include_bytes!("../../../target/deploy/loot_or_lose.so"),
    )
    .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (profile, _) = Pubkey::find_program_address(
        &[PROFILE_SEED, payer.pubkey().as_ref()],
        &loot_or_lose::id(),
    );
    let (run, _) = Pubkey::find_program_address(
        &[RUN_SEED, payer.pubkey().as_ref(), &0u64.to_le_bytes()],
        &loot_or_lose::id(),
    );
    let system = anchor_lang::system_program::ID;
    assert!(send(
        &mut svm,
        &payer,
        instruction::InitializeProfile {},
        &accounts::InitializeProfile {
            profile,
            authority: payer.pubkey(),
            system_program: system
        }
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::CreateRun { index: 0 },
        &accounts::CreateRun {
            profile,
            run,
            authority: payer.pubkey(),
            system_program: system
        }
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::CreateRun { index: 0 },
        &accounts::CreateRun {
            profile,
            run,
            authority: payer.pubkey(),
            system_program: system
        }
    ));
    let update = accounts::UpdateRun {
        run,
        session_token: None,
        signer: payer.pubkey(),
    };
    assert!(send(
        &mut svm,
        &payer,
        instruction::ActivateRun { _index: 0 },
        &update
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::OpenChest {
            _index: 0,
            expected_nonce: 0,
            chest_id: 0
        },
        &update
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 0,
            path: vec![3]
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 0,
            path: vec![1, 2]
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::OpenChest {
            _index: 0,
            expected_nonce: 1,
            chest_id: 0
        },
        &update
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::OpenChest {
            _index: 0,
            expected_nonce: 2,
            chest_id: 0
        },
        &update
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::RequestExtraction {
            _index: 0,
            expected_nonce: 2
        },
        &update
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 2,
            path: vec![1; 13]
        },
        &update
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 1,
            path: vec![1]
        },
        &update
    ));
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(!send(
        &mut svm,
        &stranger,
        instruction::Advance {
            _index: 0,
            expected_nonce: 2,
            path: vec![1]
        },
        &accounts::UpdateRun {
            run,
            session_token: None,
            signer: stranger.pubkey()
        }
    ));
    let state = run_state(&svm, &run);
    assert_eq!(state.hp, 100);
    assert_eq!(state.chest_mask, 1);
    assert_eq!(state.pending, [1, 0, 0]);
    assert_eq!(state.phase, Phase::Active);
    assert_eq!(state.final_score, 0);
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 2,
            path: vec![1; 12]
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 3,
            path: vec![2; 6]
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::RequestExtraction {
            _index: 0,
            expected_nonce: 4
        },
        &update
    ));
    assert!(!send(
        &mut svm,
        &payer,
        instruction::RequestExtraction {
            _index: 0,
            expected_nonce: 5
        },
        &update
    ));
    let state = run_state(&svm, &run);
    assert_eq!(state.phase, Phase::Extracting);
    assert_eq!(state.final_score, 10);
}

#[test]
fn nearby_hatch_allows_early_extraction_without_unearned_loot() {
    let mut svm = LiteSVM::new();
    svm.add_program(
        loot_or_lose::id(),
        include_bytes!("../../../target/deploy/loot_or_lose.so"),
    )
    .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (profile, _) = Pubkey::find_program_address(
        &[PROFILE_SEED, payer.pubkey().as_ref()],
        &loot_or_lose::id(),
    );
    let (run, _) = Pubkey::find_program_address(
        &[RUN_SEED, payer.pubkey().as_ref(), &0u64.to_le_bytes()],
        &loot_or_lose::id(),
    );
    let system = anchor_lang::system_program::ID;
    assert!(send(
        &mut svm,
        &payer,
        instruction::InitializeProfile {},
        &accounts::InitializeProfile { profile, authority: payer.pubkey(), system_program: system }
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::CreateRun { index: 0 },
        &accounts::CreateRun { profile, run, authority: payer.pubkey(), system_program: system }
    ));
    let update = accounts::UpdateRun { run, session_token: None, signer: payer.pubkey() };
    assert!(send(&mut svm, &payer, instruction::ActivateRun { _index: 0 }, &update));
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance { _index: 0, expected_nonce: 0, path: vec![2; 7] },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::RequestExtraction { _index: 0, expected_nonce: 1 },
        &update
    ));
    let state = run_state(&svm, &run);
    assert_eq!(state.phase, Phase::Extracting);
    assert_eq!(state.final_score, 0);
    assert!(!send(
        &mut svm,
        &payer,
        instruction::OpenChest { _index: 0, expected_nonce: 2, chest_id: 0 },
        &update
    ));
}

#[test]
fn rich_chest_applies_fixed_trap_damage() {
    let mut svm = LiteSVM::new();
    svm.add_program(
        loot_or_lose::id(),
        include_bytes!("../../../target/deploy/loot_or_lose.so"),
    )
    .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (profile, _) = Pubkey::find_program_address(
        &[PROFILE_SEED, payer.pubkey().as_ref()],
        &loot_or_lose::id(),
    );
    let (run, _) = Pubkey::find_program_address(
        &[RUN_SEED, payer.pubkey().as_ref(), &0u64.to_le_bytes()],
        &loot_or_lose::id(),
    );
    let system = anchor_lang::system_program::ID;
    assert!(send(&mut svm, &payer, instruction::InitializeProfile {}, &accounts::InitializeProfile {
        profile, authority: payer.pubkey(), system_program: system
    }));
    assert!(send(&mut svm, &payer, instruction::CreateRun { index: 0 }, &accounts::CreateRun {
        profile, run, authority: payer.pubkey(), system_program: system
    }));
    let update = accounts::UpdateRun { run, session_token: None, signer: payer.pubkey() };
    assert!(send(&mut svm, &payer, instruction::ActivateRun { _index: 0 }, &update));
    assert!(send(&mut svm, &payer, instruction::Advance {
        _index: 0, expected_nonce: 0, path: vec![1; 11]
    }, &update));
    assert!(send(&mut svm, &payer, instruction::Advance {
        _index: 0, expected_nonce: 1, path: vec![2; 7]
    }, &update));
    assert!(send(&mut svm, &payer, instruction::OpenChest {
        _index: 0, expected_nonce: 2, chest_id: 2
    }, &update));
    let state = run_state(&svm, &run);
    assert_eq!(state.hp, 65);
    assert_eq!(state.pending, [0, 0, 1]);
    assert_eq!(state.final_score, 0);
    assert_eq!(state.phase, Phase::Active);
}

#[test]
fn timeout_clears_credit_and_blocks_actions() {
    let mut svm = LiteSVM::new();
    svm.add_program(
        loot_or_lose::id(),
        include_bytes!("../../../target/deploy/loot_or_lose.so"),
    )
    .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (profile, _) = Pubkey::find_program_address(
        &[PROFILE_SEED, payer.pubkey().as_ref()],
        &loot_or_lose::id(),
    );
    let (run, _) = Pubkey::find_program_address(
        &[RUN_SEED, payer.pubkey().as_ref(), &0u64.to_le_bytes()],
        &loot_or_lose::id(),
    );
    let system = anchor_lang::system_program::ID;
    assert!(send(
        &mut svm,
        &payer,
        instruction::InitializeProfile {},
        &accounts::InitializeProfile {
            profile,
            authority: payer.pubkey(),
            system_program: system
        }
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::CreateRun { index: 0 },
        &accounts::CreateRun {
            profile,
            run,
            authority: payer.pubkey(),
            system_program: system
        }
    ));
    let update = accounts::UpdateRun {
        run,
        session_token: None,
        signer: payer.pubkey(),
    };
    assert!(send(
        &mut svm,
        &payer,
        instruction::ActivateRun { _index: 0 },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 0,
            path: vec![1, 2]
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::OpenChest {
            _index: 0,
            expected_nonce: 1,
            chest_id: 0
        },
        &update
    ));
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = run_state(&svm, &run).deadline + 1;
    svm.set_sysvar(&clock);
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 2,
            path: vec![1]
        },
        &update
    ));
    let state = run_state(&svm, &run);
    assert_eq!(state.phase, Phase::TimedOut);
    assert_eq!(state.final_score, 0);
    assert!(!send(
        &mut svm,
        &payer,
        instruction::RequestExtraction {
            _index: 0,
            expected_nonce: 2
        },
        &update
    ));
}

#[test]
fn guardian_death_cannot_be_extracted() {
    let mut svm = LiteSVM::new();
    svm.add_program(
        loot_or_lose::id(),
        include_bytes!("../../../target/deploy/loot_or_lose.so"),
    )
    .unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (profile, _) = Pubkey::find_program_address(
        &[PROFILE_SEED, payer.pubkey().as_ref()],
        &loot_or_lose::id(),
    );
    let (run, _) = Pubkey::find_program_address(
        &[RUN_SEED, payer.pubkey().as_ref(), &0u64.to_le_bytes()],
        &loot_or_lose::id(),
    );
    let system = anchor_lang::system_program::ID;
    assert!(send(
        &mut svm,
        &payer,
        instruction::InitializeProfile {},
        &accounts::InitializeProfile {
            profile,
            authority: payer.pubkey(),
            system_program: system
        }
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::CreateRun { index: 0 },
        &accounts::CreateRun {
            profile,
            run,
            authority: payer.pubkey(),
            system_program: system
        }
    ));
    let update = accounts::UpdateRun {
        run,
        session_token: None,
        signer: payer.pubkey(),
    };
    assert!(send(
        &mut svm,
        &payer,
        instruction::ActivateRun { _index: 0 },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 0,
            path: vec![1, 2]
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::OpenChest {
            _index: 0,
            expected_nonce: 1,
            chest_id: 0
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 2,
            path: vec![1, 1, 1, 1, 1, 1, 2, 2]
        },
        &update
    ));
    assert!(send(
        &mut svm,
        &payer,
        instruction::Advance {
            _index: 0,
            expected_nonce: 3,
            path: vec![2, 0, 2]
        },
        &update
    ));
    let state = run_state(&svm, &run);
    assert_eq!(state.phase, Phase::Dead);
    assert_eq!(state.hp, 0);
    assert_eq!(state.final_score, 0);
    assert!(!send(
        &mut svm,
        &payer,
        instruction::RequestExtraction {
            _index: 0,
            expected_nonce: 4
        },
        &update
    ));
}
