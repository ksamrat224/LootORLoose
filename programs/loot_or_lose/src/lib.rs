use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};
pub mod wager;
pub use wager::*;

declare_id!("BenkDp3MuSNQshYqTC7PyiWvpBsCQTT5LX6EGYWCQhvj");
pub const PROFILE_SEED: &[u8] = b"profile";
pub const RUN_SEED: &[u8] = b"run";
pub const START: (u8, u8) = (1, 1);
pub const EXIT: (u8, u8) = (14, 8);
pub const EARLY_EXIT: (u8, u8) = (1, 8);
pub const CHESTS: [(u8, u8); 3] = [(3, 2), (8, 7), (12, 8)];
pub const ENEMY: (u8, u8) = (8, 5);
pub const GOLD: [u16; 3] = [10, 40, 100];
pub const CHEST_TRAP_DAMAGE: [u8; 3] = [0, 15, 35];
pub const MAP: [&[u8; 16]; 10] = [
    b"################",
    b"#..............#",
    b"#..............#",
    b"#....#....#....#",
    b"#....#....#....#",
    b"#....#....#....#",
    b"#..............#",
    b"#..............#",
    b"#..............#",
    b"################",
];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Created,
    Active,
    Extracting,
    Extracted,
    Dead,
    TimedOut,
}

#[account]
pub struct PlayerProfile {
    pub authority: Pubkey,
    pub next_run_index: u64,
    pub bump: u8,
}

#[account]
pub struct RunState {
    pub authority: Pubkey,
    pub index: u64,
    pub phase: Phase,
    pub x: u8,
    pub y: u8,
    pub hp: u8,
    pub deadline: i64,
    pub chest_mask: u8,
    pub pending: [u8; 3],
    pub nonce: u64,
    pub final_score: u16,
    pub bump: u8,
}
impl RunState {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + 1 + 1 + 1 + 8 + 1 + 3 + 8 + 2 + 1;
}

fn expire_if_needed(run: &mut RunState) -> Result<bool> {
    if run.phase == Phase::Active && Clock::get()?.unix_timestamp >= run.deadline {
        run.phase = Phase::TimedOut;
        return Ok(true);
    }
    Ok(false)
}

#[ephemeral]
#[program]
pub mod loot_or_lose {
    use super::*;

    pub fn initialize_house(ctx: Context<InitializeHouse>) -> Result<()> {
        wager::initialize_house_handler(ctx)
    }
    pub fn initialize_demo_player(ctx: Context<InitializeDemoPlayer>) -> Result<()> {
        wager::initialize_player(ctx)
    }
    pub fn create_wager(ctx: Context<CreateWager>, index: u64, stake: u64) -> Result<()> {
        wager::create(ctx, index, stake)
    }
    pub fn delegate_wager(ctx: Context<DelegateWager>, index: u64) -> Result<()> {
        wager::delegate(ctx, index)
    }
    #[session_auth_or(ctx.accounts.wager.authority == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn advance_wager(
        ctx: Context<UpdateWager>,
        index: u64,
        expected_nonce: u64,
        path: Vec<u8>,
    ) -> Result<()> {
        wager::advance_handler(ctx, index, expected_nonce, path)
    }
    #[session_auth_or(ctx.accounts.wager.authority == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn risk_gate(ctx: Context<RiskGate>, index: u64, expected_nonce: u64) -> Result<()> {
        wager::risk(ctx, index, expected_nonce)
    }
    pub fn resolve_gate(
        ctx: Context<ResolveGate>,
        randomness: [u8; 32],
        index: u64,
        request_nonce: u64,
        gate: u8,
    ) -> Result<()> {
        wager::resolve(ctx, randomness, index, request_nonce, gate)
    }
    #[session_auth_or(ctx.accounts.wager.authority == ctx.accounts.signer.key(), SessionError::InvalidToken)]
    pub fn extract_wager(ctx: Context<UpdateWager>, index: u64, expected_nonce: u64) -> Result<()> {
        wager::extract(ctx, index, expected_nonce)
    }
    pub fn cancel_wager(ctx: Context<CancelWager>, index: u64) -> Result<()> {
        wager::cancel(ctx, index)
    }
    pub fn authorize_wager_session(
        ctx: Context<CancelWager>,
        _index: u64,
        session_signer: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.wager.phase == WagerPhase::Active,
            GameError::WrongPhase
        );
        ctx.accounts.wager.session_signer = session_signer;
        Ok(())
    }
    pub fn finalize_wager(ctx: Context<FinalizeWager>, index: u64) -> Result<()> {
        wager::finalize(ctx, index)
    }
    pub fn settle_wager(ctx: Context<SettleWager>, index: u64) -> Result<()> {
        wager::settle(ctx, index)
    }

    pub fn initialize_profile(ctx: Context<InitializeProfile>) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        profile.authority = ctx.accounts.authority.key();
        profile.next_run_index = 0;
        profile.bump = ctx.bumps.profile;
        Ok(())
    }

    pub fn create_run(ctx: Context<CreateRun>, index: u64) -> Result<()> {
        let profile = &mut ctx.accounts.profile;
        require_eq!(profile.next_run_index, index, GameError::WrongRunIndex);
        profile.next_run_index = index.checked_add(1).ok_or(GameError::Overflow)?;
        let run = &mut ctx.accounts.run;
        run.authority = ctx.accounts.authority.key();
        run.index = index;
        run.phase = Phase::Created;
        run.x = START.0;
        run.y = START.1;
        run.hp = 100;
        run.deadline = 0;
        run.chest_mask = 0;
        run.pending = [0; 3];
        run.nonce = 0;
        run.final_score = 0;
        run.bump = ctx.bumps.run;
        Ok(())
    }

    pub fn delegate_run(ctx: Context<DelegateRun>, index: u64) -> Result<()> {
        ctx.accounts.delegate_run(
            &ctx.accounts.authority,
            &[
                RUN_SEED,
                ctx.accounts.authority.key.as_ref(),
                &index.to_le_bytes(),
            ],
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.run.authority == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn activate_run(ctx: Context<UpdateRun>, _index: u64) -> Result<()> {
        let run = &mut ctx.accounts.run;
        require!(run.phase == Phase::Created, GameError::WrongPhase);
        run.deadline = Clock::get()?
            .unix_timestamp
            .checked_add(180)
            .ok_or(GameError::Overflow)?;
        run.phase = Phase::Active;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.run.authority == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn advance(
        ctx: Context<UpdateRun>,
        _index: u64,
        expected_nonce: u64,
        path: Vec<u8>,
    ) -> Result<()> {
        let run = &mut ctx.accounts.run;
        if expire_if_needed(run)? {
            return Ok(());
        }
        require!(run.phase == Phase::Active, GameError::WrongPhase);
        require_eq!(run.nonce, expected_nonce, GameError::StaleAction);
        require!(!path.is_empty() && path.len() <= 12, GameError::InvalidPath);
        for direction in path {
            let (dx, dy): (i16, i16) = match direction {
                0 => (0, -1),
                1 => (1, 0),
                2 => (0, 1),
                3 => (-1, 0),
                _ => return err!(GameError::InvalidPath),
            };
            let x = i16::from(run.x) + dx;
            let y = i16::from(run.y) + dy;
            require!(x >= 0 && x < 16 && y >= 0 && y < 10, GameError::InvalidPath);
            require!(MAP[y as usize][x as usize] != b'#', GameError::Wall);
            run.x = x as u8;
            run.y = y as u8;
            if run.x.abs_diff(ENEMY.0) + run.y.abs_diff(ENEMY.1) <= 1 {
                run.hp = run.hp.saturating_sub(25);
                if run.hp == 0 {
                    run.phase = Phase::Dead;
                    break;
                }
            }
        }
        run.nonce = run.nonce.checked_add(1).ok_or(GameError::Overflow)?;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.run.authority == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn open_chest(
        ctx: Context<UpdateRun>,
        _index: u64,
        expected_nonce: u64,
        chest_id: u8,
    ) -> Result<()> {
        let run = &mut ctx.accounts.run;
        if expire_if_needed(run)? {
            return Ok(());
        }
        require!(run.phase == Phase::Active, GameError::WrongPhase);
        require_eq!(run.nonce, expected_nonce, GameError::StaleAction);
        require!((chest_id as usize) < CHESTS.len(), GameError::InvalidChest);
        let bit = 1u8 << chest_id;
        require!(run.chest_mask & bit == 0, GameError::ChestOpened);
        let (x, y) = CHESTS[chest_id as usize];
        require!(
            run.x.abs_diff(x) + run.y.abs_diff(y) <= 1,
            GameError::ChestTooFar
        );
        run.chest_mask |= bit;
        run.pending[chest_id as usize] = 1;
        run.hp = run.hp.saturating_sub(CHEST_TRAP_DAMAGE[chest_id as usize]);
        if run.hp == 0 {
            run.phase = Phase::Dead;
        }
        run.nonce = run.nonce.checked_add(1).ok_or(GameError::Overflow)?;
        Ok(())
    }

    #[session_auth_or(
        ctx.accounts.run.authority == ctx.accounts.signer.key(),
        SessionError::InvalidToken
    )]
    pub fn request_extraction(
        ctx: Context<UpdateRun>,
        _index: u64,
        expected_nonce: u64,
    ) -> Result<()> {
        let run = &mut ctx.accounts.run;
        if expire_if_needed(run)? {
            return Ok(());
        }
        require!(
            run.phase == Phase::Active && run.hp > 0,
            GameError::WrongPhase
        );
        require_eq!(run.nonce, expected_nonce, GameError::StaleAction);
        require!(
            (run.x, run.y) == EXIT || (run.x, run.y) == EARLY_EXIT,
            GameError::NotAtExit
        );
        run.final_score = run
            .pending
            .iter()
            .zip(GOLD)
            .map(|(count, value)| u16::from(*count) * value)
            .sum();
        run.phase = Phase::Extracting;
        run.nonce = run.nonce.checked_add(1).ok_or(GameError::Overflow)?;
        Ok(())
    }

    pub fn expire_run(ctx: Context<ExpireRun>, _index: u64) -> Result<()> {
        let run = &mut ctx.accounts.run;
        require!(run.phase == Phase::Active, GameError::WrongPhase);
        require!(
            Clock::get()?.unix_timestamp >= run.deadline,
            GameError::NotExpired
        );
        run.phase = Phase::TimedOut;
        Ok(())
    }

    pub fn finalize_run(ctx: Context<FinalizeRun>, _index: u64) -> Result<()> {
        let run = &mut ctx.accounts.run;
        require!(
            matches!(run.phase, Phase::Extracting | Phase::Dead | Phase::TimedOut),
            GameError::WrongPhase
        );
        if run.phase == Phase::Extracting {
            run.phase = Phase::Extracted;
        }
        run.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[run.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeProfile<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 8 + 1, seeds = [PROFILE_SEED, authority.key().as_ref()], bump)]
    pub profile: Account<'info, PlayerProfile>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CreateRun<'info> {
    #[account(mut, seeds = [PROFILE_SEED, authority.key().as_ref()], bump = profile.bump, has_one = authority)]
    pub profile: Account<'info, PlayerProfile>,
    #[account(init, payer = authority, space = RunState::SPACE, seeds = [RUN_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub run: Account<'info, RunState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct DelegateRun<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The PDA derivation and delegation constraint verify this account.
    #[account(mut, del, seeds = [RUN_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub run: UncheckedAccount<'info>,
}

#[derive(Accounts, Session)]
#[instruction(index: u64)]
pub struct UpdateRun<'info> {
    #[account(mut, seeds = [RUN_SEED, run.authority.as_ref(), &index.to_le_bytes()], bump = run.bump)]
    pub run: Account<'info, RunState>,
    #[session(signer = signer, authority = run.authority)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    pub signer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(index: u64)]
pub struct ExpireRun<'info> {
    #[account(mut, seeds = [RUN_SEED, run.authority.as_ref(), &index.to_le_bytes()], bump = run.bump)]
    pub run: Account<'info, RunState>,
}

#[commit]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct FinalizeRun<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [RUN_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = run.bump, has_one = authority)]
    pub run: Account<'info, RunState>,
}

#[error_code]
pub enum GameError {
    #[msg("Wrong run index")]
    WrongRunIndex,
    #[msg("Wrong run phase")]
    WrongPhase,
    #[msg("Action nonce is stale")]
    StaleAction,
    #[msg("Path must contain one to twelve cardinal steps")]
    InvalidPath,
    #[msg("Wall blocks path")]
    Wall,
    #[msg("Invalid chest")]
    InvalidChest,
    #[msg("Chest already opened")]
    ChestOpened,
    #[msg("Chest is too far away")]
    ChestTooFar,
    #[msg("Player is not at the exit")]
    NotAtExit,
    #[msg("Run has not expired")]
    NotExpired,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Settle the existing wager before starting another")]
    ActiveWager,
    #[msg("Stake must be $1 to $100 in demo credits")]
    Stake,
    #[msg("Insufficient demo credits")]
    Balance,
    #[msg("House cannot reserve this payout")]
    Reserves,
    #[msg("Wrong wager phase")]
    Phase,
    #[msg("Action nonce is stale")]
    Nonce,
    #[msg("Invalid risk gate")]
    Gate,
    #[msg("Stand beside the next risk gate")]
    TooFar,
    #[msg("Randomness request does not match")]
    Request,
    #[msg("Unsupported wager rules")]
    Rules,
}
