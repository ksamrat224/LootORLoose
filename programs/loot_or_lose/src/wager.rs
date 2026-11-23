//! V3 demo credits only. No SOL/SPL custody or redeemable balances.
use super::*;
use crate::GameError as WagerError;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::ephem::FoldableIntentBuilder;
use ephemeral_rollups_sdk::{
    anchor::{vrf, vrf_callback},
    vrf::{
        self,
        instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};
use solana_sha256_hasher::hashv;

pub const HOUSE_SEED: &[u8] = b"demo_house_v3";
pub const PLAYER_SEED: &[u8] = b"demo_player_v3";
pub const WAGER_SEED: &[u8] = b"wager_v3";
pub const TICKET_SEED: &[u8] = b"ticket_v3";
pub const RULES_VERSION: u8 = 1;
pub const GATES: [(u8, u8); 3] = [(4, 2), (8, 7), (12, 2)];
pub const ODDS: [(u64, u64); 3] = [(19, 25), (5, 8), (2, 3)];

#[account]
#[derive(Debug)]
pub struct DemoHouse {
    pub balance: u64,
    pub reserved: u64,
    pub bump: u8,
}
#[account]
pub struct DemoPlayer {
    pub authority: Pubkey,
    pub balance: u64,
    pub next_index: u64,
    pub active: bool,
    pub active_index: u64,
    pub bump: u8,
}
#[account]
pub struct WagerTicket {
    pub authority: Pubkey,
    pub index: u64,
    pub stake: u64,
    pub reserve: u64,
    pub settled: bool,
    pub payout: u64,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum WagerPhase {
    Active,
    RandomnessPending,
    Extracting,
    Lost,
    Cancelled,
}
#[account]
pub struct WagerState {
    pub authority: Pubkey,
    pub session_signer: Pubkey,
    pub index: u64,
    pub rules_version: u8,
    pub stake: u64,
    pub phase: WagerPhase,
    pub x: u8,
    pub y: u8,
    pub gate: u8,
    pub nonce: u64,
    pub request_nonce: u64,
    pub requested_at: i64,
    pub fulfilled_at: i64,
    pub randomness: [u8; 32],
    pub payout: u64,
    pub bump: u8,
}
impl WagerState {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 1 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 32 + 8 + 1;
    pub fn terminal(&self) -> bool {
        matches!(
            self.phase,
            WagerPhase::Extracting | WagerPhase::Lost | WagerPhase::Cancelled
        )
    }
    pub fn check(&self, nonce: u64) -> Result<()> {
        require!(self.rules_version == RULES_VERSION, WagerError::Rules);
        require!(self.phase == WagerPhase::Active, WagerError::Phase);
        require_eq!(self.nonce, nonce, WagerError::Nonce);
        Ok(())
    }
    pub fn bump_nonce(&mut self) -> Result<()> {
        self.nonce = self.nonce.checked_add(1).ok_or(WagerError::Overflow)?;
        Ok(())
    }
}
pub fn payout(stake: u64, gate: u8) -> Result<u64> {
    let (n, d) = match gate {
        0 => (1, 1),
        1 => (5, 4),
        2 => (2, 1),
        3 => (3, 1),
        _ => return err!(WagerError::Gate),
    };
    stake
        .checked_mul(n)
        .map(|v| v / d)
        .ok_or_else(|| error!(WagerError::Overflow))
}
/// Rehash rejected samples; never use a modulo-biased fallback.
pub fn sample(seed: &[u8; 32], denominator: u64) -> u64 {
    let limit = u64::MAX - u64::MAX % denominator;
    let mut bytes = *seed;
    loop {
        for chunk in bytes.chunks_exact(8) {
            let value = u64::from_le_bytes(chunk.try_into().unwrap());
            if value < limit {
                return value % denominator;
            }
        }
        bytes = hashv(&[b"loot-gate-rejection-v1", &bytes]).to_bytes();
    }
}
pub fn initialize_house_handler(ctx: Context<InitializeHouse>) -> Result<()> {
    ctx.accounts.house.set_inner(DemoHouse {
        balance: 1_000_000,
        reserved: 0,
        bump: ctx.bumps.house,
    });
    Ok(())
}
pub fn initialize_player(ctx: Context<InitializeDemoPlayer>) -> Result<()> {
    ctx.accounts.player.set_inner(DemoPlayer {
        authority: ctx.accounts.authority.key(),
        balance: 10_000,
        next_index: 0,
        active: false,
        active_index: 0,
        bump: ctx.bumps.player,
    });
    Ok(())
}
pub fn create(ctx: Context<CreateWager>, index: u64, stake: u64) -> Result<()> {
    let player = &mut ctx.accounts.player;
    require!(
        !player.active && player.next_index == index,
        WagerError::ActiveWager
    );
    require!((100..=10_000).contains(&stake), WagerError::Stake);
    require!(player.balance >= stake, WagerError::Balance);
    let reserve = payout(stake, 3)?;
    let house = &mut ctx.accounts.house;
    let balance = house
        .balance
        .checked_add(stake)
        .ok_or(WagerError::Overflow)?;
    let reserved = house
        .reserved
        .checked_add(reserve)
        .ok_or(WagerError::Overflow)?;
    require!(balance >= reserved, WagerError::Reserves);
    house.balance = balance;
    house.reserved = reserved;
    player.balance -= stake;
    player.active = true;
    player.active_index = index;
    player.next_index = index.checked_add(1).ok_or(WagerError::Overflow)?;
    ctx.accounts.ticket.set_inner(WagerTicket {
        authority: player.authority,
        index,
        stake,
        reserve,
        settled: false,
        payout: 0,
        bump: ctx.bumps.ticket,
    });
    ctx.accounts.wager.set_inner(WagerState {
        authority: player.authority,
        session_signer: Pubkey::default(),
        index,
        rules_version: RULES_VERSION,
        stake,
        phase: WagerPhase::Active,
        x: START.0,
        y: START.1,
        gate: 0,
        nonce: 0,
        request_nonce: 0,
        requested_at: 0,
        fulfilled_at: 0,
        randomness: [0; 32],
        payout: 0,
        bump: ctx.bumps.wager,
    });
    Ok(())
}
pub fn delegate(ctx: Context<DelegateWager>, index: u64) -> Result<()> {
    ctx.accounts.delegate_wager(
        &ctx.accounts.authority,
        &[
            WAGER_SEED,
            ctx.accounts.authority.key.as_ref(),
            &index.to_le_bytes(),
        ],
        DelegateConfig::default(),
    )?;
    Ok(())
}
pub fn advance_handler(
    ctx: Context<UpdateWager>,
    _index: u64,
    nonce: u64,
    path: Vec<u8>,
) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    wager.check(nonce)?;
    require!(!path.is_empty() && path.len() <= 12, GameError::InvalidPath);
    for direction in path {
        let (dx, dy) = match direction {
            0 => (0, -1),
            1 => (1, 0),
            2 => (0, 1),
            3 => (-1, 0),
            _ => return err!(GameError::InvalidPath),
        };
        let x = i16::from(wager.x) + dx;
        let y = i16::from(wager.y) + dy;
        require!(
            (0..16).contains(&x) && (0..10).contains(&y) && MAP[y as usize][x as usize] == b'.',
            GameError::Wall
        );
        wager.x = x as u8;
        wager.y = y as u8;
    }
    wager.bump_nonce()
}
pub fn risk(ctx: Context<RiskGate>, index: u64, nonce: u64) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    wager.check(nonce)?;
    require!(wager.gate < 3, WagerError::Gate);
    let gate = GATES[wager.gate as usize];
    require!(
        wager.x.abs_diff(gate.0) + wager.y.abs_diff(gate.1) <= 1,
        WagerError::TooFar
    );
    wager.bump_nonce()?;
    wager.request_nonce = wager.nonce;
    wager.requested_at = Clock::get()?.unix_timestamp;
    wager.phase = WagerPhase::RandomnessPending;
    let seed = hashv(&[
        b"loot-risk-v1",
        wager.key().as_ref(),
        &wager.request_nonce.to_le_bytes(),
    ])
    .to_bytes();
    let mut args = index.to_le_bytes().to_vec();
    args.extend_from_slice(&wager.request_nonce.to_le_bytes());
    args.push(wager.gate);
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.signer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ResolveGate::DISCRIMINATOR.to_vec(),
        caller_seed: seed,
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: wager.key(),
            is_signer: false,
            is_writable: true,
        }]),
        callback_args: Some(args),
    });
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.signer.to_account_info(), &ix)?;
    Ok(())
}
pub fn resolve(
    ctx: Context<ResolveGate>,
    randomness: [u8; 32],
    _index: u64,
    request_nonce: u64,
    gate: u8,
) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    require!(
        wager.phase == WagerPhase::RandomnessPending
            && wager.request_nonce == request_nonce
            && wager.gate == gate,
        WagerError::Request
    );
    require!(
        gate < 3 && wager.rules_version == RULES_VERSION,
        WagerError::Rules
    );
    let (numerator, denominator) = ODDS[gate as usize];
    wager.randomness = randomness;
    wager.fulfilled_at = Clock::get()?.unix_timestamp;
    if sample(&randomness, denominator) < numerator {
        wager.gate += 1;
        wager.phase = WagerPhase::Active;
        if wager.gate == 3 {
            wager.payout = payout(wager.stake, 3)?;
            wager.phase = WagerPhase::Extracting;
        }
    } else {
        wager.payout = 0;
        wager.phase = WagerPhase::Lost;
    }
    wager.bump_nonce()
}
pub fn extract(ctx: Context<UpdateWager>, _index: u64, nonce: u64) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    wager.check(nonce)?;
    require!(wager.gate > 0 && wager.gate < 3, WagerError::Gate);
    // Extraction is available immediately after a gate; walking cannot add financial risk.
    wager.payout = payout(wager.stake, wager.gate)?;
    wager.phase = WagerPhase::Extracting;
    wager.bump_nonce()
}
pub fn cancel(ctx: Context<CancelWager>, _index: u64) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    require!(
        wager.phase == WagerPhase::Active && wager.gate == 0 && wager.requested_at == 0,
        WagerError::Phase
    );
    wager.phase = WagerPhase::Cancelled;
    wager.payout = wager.stake;
    wager.bump_nonce()
}
pub fn finalize(ctx: Context<FinalizeWager>, _index: u64) -> Result<()> {
    require!(ctx.accounts.wager.terminal(), WagerError::Phase);
    ctx.accounts.wager.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.wager.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}
pub fn settle(ctx: Context<SettleWager>, index: u64) -> Result<()> {
    let ticket = &mut ctx.accounts.ticket;
    if ticket.settled {
        return Ok(());
    }
    let wager = &ctx.accounts.wager;
    let player = &mut ctx.accounts.player;
    let house = &mut ctx.accounts.house;
    require!(
        player.active && player.active_index == index && wager.terminal(),
        WagerError::Phase
    );
    require!(
        wager.rules_version == RULES_VERSION && ticket.stake == wager.stake,
        WagerError::Rules
    );
    let expected = match wager.phase {
        WagerPhase::Cancelled => wager.stake,
        WagerPhase::Lost => 0,
        WagerPhase::Extracting => {
            require!(wager.gate > 0, WagerError::Gate);
            payout(wager.stake, wager.gate)?
        }
        _ => return err!(WagerError::Phase),
    };
    require!(
        expected == wager.payout && expected <= ticket.reserve,
        WagerError::Reserves
    );
    house.balance = house
        .balance
        .checked_sub(expected)
        .ok_or(WagerError::Reserves)?;
    house.reserved = house
        .reserved
        .checked_sub(ticket.reserve)
        .ok_or(WagerError::Reserves)?;
    require!(house.balance >= house.reserved, WagerError::Reserves);
    player.balance = player
        .balance
        .checked_add(expected)
        .ok_or(WagerError::Overflow)?;
    player.active = false;
    ticket.payout = expected;
    ticket.settled = true;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeHouse<'info> {
    #[account(init, payer = authority, space = 8+8+8+1, seeds = [HOUSE_SEED], bump)]
    pub house: Account<'info, DemoHouse>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeDemoPlayer<'info> {
    #[account(init, payer = authority, space = 8+32+8+8+1+8+1, seeds = [PLAYER_SEED, authority.key().as_ref()], bump)]
    pub player: Account<'info, DemoPlayer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CreateWager<'info> {
    #[account(mut, seeds = [HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, DemoHouse>,
    #[account(mut, seeds = [PLAYER_SEED, authority.key().as_ref()], bump = player.bump, has_one = authority)]
    pub player: Account<'info, DemoPlayer>,
    #[account(init, payer = authority, space = 8+32+8+8+8+1+8+1, seeds = [TICKET_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub ticket: Account<'info, WagerTicket>,
    #[account(init, payer = authority, space = WagerState::SPACE, seeds = [WAGER_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub wager: Account<'info, WagerState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[delegate]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct DelegateWager<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Delegation macro and versioned PDA seeds validate this account.
    #[account(mut, del, seeds = [WAGER_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub wager: UncheckedAccount<'info>,
}
#[derive(Accounts, Session)]
#[instruction(index: u64)]
pub struct UpdateWager<'info> {
    #[account(mut, seeds = [WAGER_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, WagerState>,
    #[session(signer = signer, authority = wager.authority)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(constraint = signer.key() == wager.authority || signer.key() == wager.session_signer)]
    pub signer: Signer<'info>,
}
#[vrf]
#[derive(Accounts, Session)]
#[instruction(index: u64)]
pub struct RiskGate<'info> {
    #[account(mut, seeds = [WAGER_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, WagerState>,
    #[session(signer = signer, authority = wager.authority)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(mut, constraint = signer.key() == wager.authority || signer.key() == wager.session_signer)]
    pub signer: Signer<'info>,
    /// CHECK: Only the documented queue for the selected runtime is permitted.
    #[account(mut, constraint = oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE || oracle_queue.key() == vrf::consts::DEFAULT_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}
#[vrf_callback]
#[derive(Accounts)]
#[instruction(randomness: [u8;32], index: u64)]
pub struct ResolveGate<'info> {
    #[account(mut, seeds = [WAGER_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, WagerState>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CancelWager<'info> {
    #[account(mut, seeds = [WAGER_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, WagerState>,
    pub authority: Signer<'info>,
}
#[commit]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct FinalizeWager<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [WAGER_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, WagerState>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct SettleWager<'info> {
    #[account(mut, seeds = [HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, DemoHouse>,
    #[account(mut, seeds = [PLAYER_SEED, authority.key().as_ref()], bump = player.bump, has_one = authority)]
    pub player: Account<'info, DemoPlayer>,
    #[account(mut, seeds = [TICKET_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = ticket.bump, has_one = authority)]
    pub ticket: Account<'info, WagerTicket>,
    // Account<T> requires original program ownership, rejecting still-delegated base accounts.
    #[account(seeds = [WAGER_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, WagerState>,
    pub authority: Signer<'info>,
}
