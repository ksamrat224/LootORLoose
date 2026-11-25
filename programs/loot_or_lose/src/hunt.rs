//! V5 demo credits only. No SOL/SPL custody or redeemable balances.
use super::*;
use crate::wager::sample;
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

pub const HUNT_HOUSE_SEED: &[u8] = b"hunt_house_v5";
pub const HUNT_PLAYER_SEED: &[u8] = b"hunt_player_v5";
pub const HUNT_SEED: &[u8] = b"hunt_attempt_v5";
pub const HUNT_TICKET_SEED: &[u8] = b"hunt_ticket_v5";
pub const HUNT_RULES_VERSION: u8 = 5;
pub const NO_QUEST: u8 = 255;
pub const HUNT_QUESTS: [(u8, u8); 6] = [(4, 2), (3, 7), (8, 7), (8, 2), (12, 2), (12, 7)];
#[account]
#[derive(Debug)]
pub struct HuntHouse {
    pub balance: u64,
    pub reserved: u64,
    pub bump: u8,
}
#[account]
pub struct HuntPlayer {
    pub authority: Pubkey,
    pub balance: u64,
    pub next_index: u64,
    pub active: bool,
    pub active_index: u64,
    pub bump: u8,
}
#[account]
pub struct HuntTicket {
    pub quest_id: u8,
    pub authority: Pubkey,
    pub index: u64,
    pub stake: u64,
    pub reserve: u64,
    pub settled: bool,
    pub payout: u64,
    pub bump: u8,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum HuntPhase {
    Active,
    RandomnessPending,
    Complete,
    Cancelled,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug)]
pub struct HuntReveal {
    pub quest_id: u8,
    pub randomness: [u8; 32],
    pub bucket: u8,
    pub reward: u64,
}
#[account]
pub struct HuntAttempt {
    pub authority: Pubkey,
    pub session_signer: Pubkey,
    pub index: u64,
    pub rules_version: u8,
    pub stake: u64,
    pub phase: HuntPhase,
    pub x: u8,
    pub y: u8,
    pub quest_id: u8,
    pub nonce: u64,
    pub request_nonce: u64,
    pub requested_at: i64,
    pub fulfilled_at: i64,
    pub opened_mask: u8,
    pub reveal_count: u8,
    pub reveals: [HuntReveal; 3],
    pub payout: u64,
    pub bump: u8,
}
impl HuntAttempt {
    pub const SPACE: usize = 8
        + 32
        + 32
        + 8
        + 1
        + 8
        + 1
        + 1
        + 1
        + 1
        + 8
        + 8
        + 8
        + 8
        + 1
        + 1
        + 3 * (1 + 32 + 1 + 8)
        + 8
        + 1;
    pub fn terminal(&self) -> bool {
        matches!(self.phase, HuntPhase::Complete | HuntPhase::Cancelled)
    }
    pub fn check(&self, nonce: u64) -> Result<()> {
        require!(self.rules_version == HUNT_RULES_VERSION, WagerError::Rules);
        require!(self.phase == HuntPhase::Active, WagerError::Phase);
        require_eq!(self.nonce, nonce, WagerError::Nonce);
        Ok(())
    }
    pub fn bump_nonce(&mut self) -> Result<()> {
        self.nonce = self.nonce.checked_add(1).ok_or(WagerError::Overflow)?;
        Ok(())
    }
}
pub fn hunt_reward(stake: u64, bucket: u8) -> Result<u64> {
    let (n, d) = match bucket {
        0..=39 => (0, 1),
        40..=69 => (1, 4),
        70..=89 => (1, 2),
        90..=97 => (1, 1),
        98..=99 => (5, 3),
        _ => return err!(WagerError::Rules),
    };
    stake
        .checked_mul(n)
        .map(|v| v / d)
        .ok_or_else(|| error!(WagerError::Overflow))
}
pub fn hunt_reserve(stake: u64) -> Result<u64> {
    hunt_reward(stake, 99)?
        .checked_mul(3)
        .ok_or_else(|| error!(WagerError::Overflow))
}
/// Validate every submitted step from the last confirmed approach position.
pub fn hunt_approach(start: (u8, u8), quest_id: u8, path: &[u8]) -> Result<(u8, u8)> {
    require!(quest_id < 6, WagerError::Gate);
    require!(path.len() <= 64, WagerError::InvalidPath);
    let (mut x, mut y) = (i16::from(start.0), i16::from(start.1));
    require!(
        x < 16 && y < 10 && MAP[y as usize][x as usize] == b'.',
        WagerError::Wall
    );
    for direction in path {
        let (dx, dy) = match direction {
            0 => (0, -1),
            1 => (1, 0),
            2 => (0, 1),
            3 => (-1, 0),
            _ => return err!(WagerError::InvalidPath),
        };
        x += dx;
        y += dy;
        require!(
            (0..16).contains(&x) && (0..10).contains(&y) && MAP[y as usize][x as usize] == b'.',
            WagerError::Wall
        );
    }
    let target = HUNT_QUESTS[quest_id as usize];
    require!(
        (x as u8).abs_diff(target.0) + (y as u8).abs_diff(target.1) <= 1,
        WagerError::TooFar
    );
    Ok((x as u8, y as u8))
}
/// The VRF CPI runs in the same atomic transaction as this transition.
pub fn prepare_hunt_reveal(
    wager: &mut HuntAttempt,
    nonce: u64,
    quest_id: u8,
    path: &[u8],
    now: i64,
) -> Result<()> {
    wager.check(nonce)?;
    require!(
        wager.reveal_count < 3 && quest_id < 6 && wager.opened_mask & (1 << quest_id) == 0,
        WagerError::Gate
    );
    let position = hunt_approach((wager.x, wager.y), quest_id, path)?;
    wager.quest_id = quest_id;
    wager.x = position.0;
    wager.y = position.1;
    wager.bump_nonce()?;
    wager.request_nonce = wager.nonce;
    wager.requested_at = now;
    wager.phase = HuntPhase::RandomnessPending;
    Ok(())
}
pub fn verified_hunt_total(wager: &HuntAttempt) -> Result<u64> {
    if wager.phase == HuntPhase::Cancelled {
        require!(
            wager.reveal_count == 0 && wager.request_nonce == 0 && wager.opened_mask == 0,
            WagerError::Rules
        );
        return Ok(wager.stake);
    }
    require!(
        wager.phase == HuntPhase::Complete && wager.reveal_count == 3,
        WagerError::Phase
    );
    let mut mask = 0u8;
    let mut total = 0u64;
    for reveal in wager.reveals {
        require!(
            reveal.quest_id < 6 && mask & (1 << reveal.quest_id) == 0,
            WagerError::Rules
        );
        mask |= 1 << reveal.quest_id;
        let bucket = sample(&reveal.randomness, 100) as u8;
        require!(
            bucket == reveal.bucket && hunt_reward(wager.stake, bucket)? == reveal.reward,
            WagerError::Rules
        );
        total = total
            .checked_add(reveal.reward)
            .ok_or(WagerError::Overflow)?;
    }
    require!(mask == wager.opened_mask, WagerError::Rules);
    Ok(total)
}
pub fn hunt_initialize_house_handler(ctx: Context<InitializeHuntHouse>) -> Result<()> {
    ctx.accounts.house.set_inner(HuntHouse {
        balance: 1_000_000,
        reserved: 0,
        bump: ctx.bumps.house,
    });
    Ok(())
}
pub fn hunt_initialize_player(ctx: Context<InitializeHuntPlayer>) -> Result<()> {
    ctx.accounts.player.set_inner(HuntPlayer {
        authority: ctx.accounts.authority.key(),
        balance: 10_000,
        next_index: 0,
        active: false,
        active_index: 0,
        bump: ctx.bumps.player,
    });
    Ok(())
}
pub fn hunt_create(ctx: Context<CreateHuntAttempt>, index: u64, stake: u64) -> Result<()> {
    let position = START;
    let quest_id = NO_QUEST;
    let player = &mut ctx.accounts.player;
    require!(
        !player.active && player.next_index == index,
        WagerError::ActiveWager
    );
    require!((100..=10_000).contains(&stake), WagerError::Stake);
    require!(player.balance >= stake, WagerError::Balance);
    let reserve = hunt_reserve(stake)?;
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
    ctx.accounts.ticket.set_inner(HuntTicket {
        quest_id,
        authority: player.authority,
        index,
        stake,
        reserve,
        settled: false,
        payout: 0,
        bump: ctx.bumps.ticket,
    });
    ctx.accounts.wager.set_inner(HuntAttempt {
        authority: player.authority,
        session_signer: Pubkey::default(),
        index,
        rules_version: HUNT_RULES_VERSION,
        stake,
        phase: HuntPhase::Active,
        x: position.0,
        y: position.1,
        quest_id,
        nonce: 0,
        request_nonce: 0,
        requested_at: 0,
        fulfilled_at: 0,
        opened_mask: 0,
        reveal_count: 0,
        reveals: [HuntReveal::default(); 3],
        payout: 0,
        bump: ctx.bumps.wager,
    });
    Ok(())
}
pub fn hunt_delegate(ctx: Context<DelegateHuntAttempt>, index: u64) -> Result<()> {
    ctx.accounts.delegate_wager(
        &ctx.accounts.authority,
        &[
            HUNT_SEED,
            ctx.accounts.authority.key.as_ref(),
            &index.to_le_bytes(),
        ],
        DelegateConfig::default(),
    )?;
    Ok(())
}
pub fn hunt_risk(
    ctx: Context<RiskHunt>,
    index: u64,
    nonce: u64,
    quest_id: u8,
    approach_path: Vec<u8>,
) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    prepare_hunt_reveal(
        wager,
        nonce,
        quest_id,
        &approach_path,
        Clock::get()?.unix_timestamp,
    )?;
    let seed = hashv(&[
        b"loot-hunt-v5",
        wager.key().as_ref(),
        &wager.request_nonce.to_le_bytes(),
    ])
    .to_bytes();
    let mut args = index.to_le_bytes().to_vec();
    args.extend_from_slice(&wager.request_nonce.to_le_bytes());
    args.push(wager.quest_id);
    args.push(wager.reveal_count);
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.signer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ResolveHunt::DISCRIMINATOR.to_vec(),
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
pub fn hunt_resolve(
    ctx: Context<ResolveHunt>,
    randomness: [u8; 32],
    _index: u64,
    request_nonce: u64,
    quest_id: u8,
    reveal_index: u8,
) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    require!(
        wager.phase == HuntPhase::RandomnessPending
            && wager.request_nonce == request_nonce
            && wager.quest_id == quest_id
            && wager.reveal_count == reveal_index
            && reveal_index < 3
            && quest_id < 6
            && wager.opened_mask & (1 << quest_id) == 0,
        WagerError::Request
    );
    require!(
        quest_id < 6 && wager.rules_version == HUNT_RULES_VERSION,
        WagerError::Rules
    );
    let bucket = sample(&randomness, 100) as u8;
    let reward = hunt_reward(wager.stake, bucket)?;
    wager.reveals[reveal_index as usize] = HuntReveal {
        quest_id,
        randomness,
        bucket,
        reward,
    };
    wager.payout = wager
        .payout
        .checked_add(reward)
        .ok_or(WagerError::Overflow)?;
    wager.opened_mask |= 1 << quest_id;
    wager.reveal_count += 1;
    wager.fulfilled_at = Clock::get()?.unix_timestamp;
    wager.phase = if wager.reveal_count == 3 {
        HuntPhase::Complete
    } else {
        HuntPhase::Active
    };
    wager.bump_nonce()
}
pub fn hunt_cancel(ctx: Context<CancelHuntAttempt>, _index: u64) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    require!(
        wager.phase == HuntPhase::Active && wager.request_nonce == 0 && wager.reveal_count == 0,
        WagerError::Phase
    );
    wager.phase = HuntPhase::Cancelled;
    wager.payout = wager.stake;
    wager.bump_nonce()
}
pub fn hunt_finalize(ctx: Context<FinalizeHuntAttempt>, _index: u64) -> Result<()> {
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
pub fn hunt_settle(ctx: Context<SettleHuntAttempt>, index: u64) -> Result<()> {
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
        wager.rules_version == HUNT_RULES_VERSION
            && ticket.stake == wager.stake
            && ticket.quest_id == NO_QUEST
            && ticket.reserve == hunt_reserve(wager.stake)?,
        WagerError::Rules
    );
    let expected = verified_hunt_total(wager)?;
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
pub struct InitializeHuntHouse<'info> {
    #[account(init, payer = authority, space = 8+8+8+1, seeds = [HUNT_HOUSE_SEED], bump)]
    pub house: Account<'info, HuntHouse>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeHuntPlayer<'info> {
    #[account(init, payer = authority, space = 8+32+8+8+1+8+1, seeds = [HUNT_PLAYER_SEED, authority.key().as_ref()], bump)]
    pub player: Account<'info, HuntPlayer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CreateHuntAttempt<'info> {
    #[account(mut, seeds = [HUNT_HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, HuntHouse>,
    #[account(mut, seeds = [HUNT_PLAYER_SEED, authority.key().as_ref()], bump = player.bump, has_one = authority)]
    pub player: Account<'info, HuntPlayer>,
    #[account(init, payer = authority, space = 8+1+32+8+8+8+1+8+1, seeds = [HUNT_TICKET_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub ticket: Account<'info, HuntTicket>,
    #[account(init, payer = authority, space = HuntAttempt::SPACE, seeds = [HUNT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub wager: Account<'info, HuntAttempt>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[delegate]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct DelegateHuntAttempt<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Delegation macro and versioned PDA seeds validate this account.
    #[account(mut, del, seeds = [HUNT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub wager: UncheckedAccount<'info>,
}
#[derive(Accounts, Session)]
#[instruction(index: u64)]
pub struct UpdateHuntAttempt<'info> {
    #[account(mut, seeds = [HUNT_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, HuntAttempt>,
    #[session(signer = signer, authority = wager.authority)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(constraint = signer.key() == wager.authority || signer.key() == wager.session_signer)]
    pub signer: Signer<'info>,
}
#[vrf]
#[derive(Accounts, Session)]
#[instruction(index: u64)]
pub struct RiskHunt<'info> {
    #[account(mut, seeds = [HUNT_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, HuntAttempt>,
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
pub struct ResolveHunt<'info> {
    #[account(mut, seeds = [HUNT_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, HuntAttempt>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CancelHuntAttempt<'info> {
    #[account(mut, seeds = [HUNT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, HuntAttempt>,
    pub authority: Signer<'info>,
}
#[commit]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct FinalizeHuntAttempt<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [HUNT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, HuntAttempt>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct SettleHuntAttempt<'info> {
    #[account(mut, seeds = [HUNT_HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, HuntHouse>,
    #[account(mut, seeds = [HUNT_PLAYER_SEED, authority.key().as_ref()], bump = player.bump, has_one = authority)]
    pub player: Account<'info, HuntPlayer>,
    #[account(mut, seeds = [HUNT_TICKET_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = ticket.bump, has_one = authority)]
    pub ticket: Account<'info, HuntTicket>,
    // Account<T> requires original program ownership, rejecting still-delegated base accounts.
    #[account(seeds = [HUNT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, HuntAttempt>,
    pub authority: Signer<'info>,
}
