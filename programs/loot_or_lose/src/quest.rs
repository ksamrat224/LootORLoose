//! V4 demo credits only. No SOL/SPL custody or redeemable balances.
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

pub const QUEST_HOUSE_SEED: &[u8] = b"quest_house_v4";
pub const QUEST_PLAYER_SEED: &[u8] = b"quest_player_v4";
pub const ATTEMPT_SEED: &[u8] = b"quest_attempt_v4";
pub const QUEST_TICKET_SEED: &[u8] = b"quest_ticket_v4";
pub const QUEST_RULES_VERSION: u8 = 4;
pub const UNCHOSEN_QUEST: u8 = 255;
pub const QUESTS: [(u8, u8); 6] = [(4, 2), (3, 7), (8, 7), (8, 2), (12, 2), (12, 7)];
pub const QUEST_ODDS: [(u64, u64); 6] =
    [(19, 25), (19, 30), (19, 40), (19, 50), (19, 60), (19, 100)];

#[account]
#[derive(Debug)]
pub struct QuestHouse {
    pub balance: u64,
    pub reserved: u64,
    pub bump: u8,
}
#[account]
pub struct QuestPlayer {
    pub authority: Pubkey,
    pub balance: u64,
    pub next_index: u64,
    pub active: bool,
    pub active_index: u64,
    pub bump: u8,
}
#[account]
pub struct QuestTicket {
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
pub enum QuestPhase {
    Active,
    RandomnessPending,
    Succeeded,
    Lost,
    Cancelled,
}
#[account]
pub struct QuestAttempt {
    pub authority: Pubkey,
    pub session_signer: Pubkey,
    pub index: u64,
    pub rules_version: u8,
    pub stake: u64,
    pub phase: QuestPhase,
    pub x: u8,
    pub y: u8,
    pub quest_id: u8,
    pub nonce: u64,
    pub request_nonce: u64,
    pub requested_at: i64,
    pub fulfilled_at: i64,
    pub randomness: [u8; 32],
    pub payout: u64,
    pub bump: u8,
}
impl QuestAttempt {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 1 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 32 + 8 + 1;
    pub fn terminal(&self) -> bool {
        matches!(
            self.phase,
            QuestPhase::Succeeded | QuestPhase::Lost | QuestPhase::Cancelled
        )
    }
    pub fn check(&self, nonce: u64) -> Result<()> {
        require!(self.rules_version == QUEST_RULES_VERSION, WagerError::Rules);
        require!(self.phase == QuestPhase::Active, WagerError::Phase);
        require_eq!(self.nonce, nonce, WagerError::Nonce);
        Ok(())
    }
    pub fn bump_nonce(&mut self) -> Result<()> {
        self.nonce = self.nonce.checked_add(1).ok_or(WagerError::Overflow)?;
        Ok(())
    }
}
pub fn quest_payout(stake: u64, quest_id: u8) -> Result<u64> {
    let (n, d) = match quest_id {
        0 => (5, 4),
        1 => (3, 2),
        2 => (2, 1),
        3 => (5, 2),
        4 => (3, 1),
        5 => (5, 1),
        _ => return err!(WagerError::Gate),
    };
    stake
        .checked_mul(n)
        .map(|v| v / d)
        .ok_or_else(|| error!(WagerError::Overflow))
}
/// Validate the complete approach from the unchanged spawn, before any debit.
pub fn approach(quest_id: u8, path: &[u8]) -> Result<(u8, u8)> {
    require!((quest_id as usize) < QUESTS.len(), WagerError::Gate);
    require!(path.len() <= 64, WagerError::InvalidPath);
    let (mut x, mut y) = (i16::from(START.0), i16::from(START.1));
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
    let target = QUESTS[quest_id as usize];
    require!(
        (x as u8).abs_diff(target.0) + (y as u8).abs_diff(target.1) <= 1,
        WagerError::TooFar
    );
    Ok((x as u8, y as u8))
}
pub fn quest_initialize_house_handler(ctx: Context<InitializeQuestHouse>) -> Result<()> {
    ctx.accounts.house.set_inner(QuestHouse {
        balance: 1_000_000,
        reserved: 0,
        bump: ctx.bumps.house,
    });
    Ok(())
}
pub fn quest_initialize_player(ctx: Context<InitializeQuestPlayer>) -> Result<()> {
    ctx.accounts.player.set_inner(QuestPlayer {
        authority: ctx.accounts.authority.key(),
        balance: 10_000,
        next_index: 0,
        active: false,
        active_index: 0,
        bump: ctx.bumps.player,
    });
    Ok(())
}
pub fn quest_create(
    ctx: Context<CreateQuestAttempt>,
    index: u64,
    stake: u64,
    quest_id: u8,
    approach_path: Vec<u8>,
) -> Result<()> {
    let position = if quest_id == UNCHOSEN_QUEST {
        require!(approach_path.is_empty(), WagerError::InvalidPath);
        START
    } else {
        approach(quest_id, &approach_path)?
    };
    let player = &mut ctx.accounts.player;
    require!(
        !player.active && player.next_index == index,
        WagerError::ActiveWager
    );
    require!((100..=10_000).contains(&stake), WagerError::Stake);
    require!(player.balance >= stake, WagerError::Balance);
    let reserve = quest_payout(
        stake,
        if quest_id == UNCHOSEN_QUEST {
            5
        } else {
            quest_id
        },
    )?;
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
    ctx.accounts.ticket.set_inner(QuestTicket {
        quest_id,
        authority: player.authority,
        index,
        stake,
        reserve,
        settled: false,
        payout: 0,
        bump: ctx.bumps.ticket,
    });
    ctx.accounts.wager.set_inner(QuestAttempt {
        authority: player.authority,
        session_signer: Pubkey::default(),
        index,
        rules_version: QUEST_RULES_VERSION,
        stake,
        phase: QuestPhase::Active,
        x: position.0,
        y: position.1,
        quest_id,
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
pub fn quest_delegate(ctx: Context<DelegateQuestAttempt>, index: u64) -> Result<()> {
    ctx.accounts.delegate_wager(
        &ctx.accounts.authority,
        &[
            ATTEMPT_SEED,
            ctx.accounts.authority.key.as_ref(),
            &index.to_le_bytes(),
        ],
        DelegateConfig::default(),
    )?;
    Ok(())
}
pub fn quest_risk(
    ctx: Context<RiskQuest>,
    index: u64,
    nonce: u64,
    quest_id: u8,
    approach_path: Vec<u8>,
) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    wager.check(nonce)?;
    require!(
        wager.quest_id == UNCHOSEN_QUEST || wager.quest_id == quest_id,
        WagerError::Gate
    );
    let position = approach(quest_id, &approach_path)?;
    wager.quest_id = quest_id;
    wager.x = position.0;
    wager.y = position.1;
    wager.bump_nonce()?;
    wager.request_nonce = wager.nonce;
    wager.requested_at = Clock::get()?.unix_timestamp;
    wager.phase = QuestPhase::RandomnessPending;
    let seed = hashv(&[
        b"loot-quest-v4",
        wager.key().as_ref(),
        &wager.request_nonce.to_le_bytes(),
    ])
    .to_bytes();
    let mut args = index.to_le_bytes().to_vec();
    args.extend_from_slice(&wager.request_nonce.to_le_bytes());
    args.push(wager.quest_id);
    let ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.signer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator: crate::instruction::ResolveQuest::DISCRIMINATOR.to_vec(),
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
pub fn quest_resolve(
    ctx: Context<ResolveQuest>,
    randomness: [u8; 32],
    _index: u64,
    request_nonce: u64,
    quest_id: u8,
) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    require!(
        wager.phase == QuestPhase::RandomnessPending
            && wager.request_nonce == request_nonce
            && wager.quest_id == quest_id,
        WagerError::Request
    );
    require!(
        quest_id < 6 && wager.rules_version == QUEST_RULES_VERSION,
        WagerError::Rules
    );
    let (numerator, denominator) = QUEST_ODDS[quest_id as usize];
    wager.randomness = randomness;
    wager.fulfilled_at = Clock::get()?.unix_timestamp;
    if sample(&randomness, denominator) < numerator {
        wager.payout = quest_payout(wager.stake, wager.quest_id)?;
        wager.phase = QuestPhase::Succeeded;
    } else {
        wager.payout = 0;
        wager.phase = QuestPhase::Lost;
    }
    wager.bump_nonce()
}
pub fn quest_cancel(ctx: Context<CancelQuestAttempt>, _index: u64) -> Result<()> {
    let wager = &mut ctx.accounts.wager;
    require!(
        wager.phase == QuestPhase::Active && wager.requested_at == 0,
        WagerError::Phase
    );
    wager.phase = QuestPhase::Cancelled;
    wager.payout = wager.stake;
    wager.bump_nonce()
}
pub fn quest_finalize(ctx: Context<FinalizeQuestAttempt>, _index: u64) -> Result<()> {
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
pub fn quest_settle(ctx: Context<SettleQuestAttempt>, index: u64) -> Result<()> {
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
        wager.rules_version == QUEST_RULES_VERSION
            && ticket.stake == wager.stake
            && (ticket.quest_id == wager.quest_id
                || (ticket.quest_id == UNCHOSEN_QUEST
                    && (wager.quest_id < 6 || wager.phase == QuestPhase::Cancelled))),
        WagerError::Rules
    );
    let expected = match wager.phase {
        QuestPhase::Cancelled => wager.stake,
        QuestPhase::Lost => 0,
        QuestPhase::Succeeded => quest_payout(wager.stake, wager.quest_id)?,
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
pub struct InitializeQuestHouse<'info> {
    #[account(init, payer = authority, space = 8+8+8+1, seeds = [QUEST_HOUSE_SEED], bump)]
    pub house: Account<'info, QuestHouse>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct InitializeQuestPlayer<'info> {
    #[account(init, payer = authority, space = 8+32+8+8+1+8+1, seeds = [QUEST_PLAYER_SEED, authority.key().as_ref()], bump)]
    pub player: Account<'info, QuestPlayer>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CreateQuestAttempt<'info> {
    #[account(mut, seeds = [QUEST_HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, QuestHouse>,
    #[account(mut, seeds = [QUEST_PLAYER_SEED, authority.key().as_ref()], bump = player.bump, has_one = authority)]
    pub player: Account<'info, QuestPlayer>,
    #[account(init, payer = authority, space = 8+1+32+8+8+8+1+8+1, seeds = [QUEST_TICKET_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub ticket: Account<'info, QuestTicket>,
    #[account(init, payer = authority, space = QuestAttempt::SPACE, seeds = [ATTEMPT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub wager: Account<'info, QuestAttempt>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}
#[delegate]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct DelegateQuestAttempt<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Delegation macro and versioned PDA seeds validate this account.
    #[account(mut, del, seeds = [ATTEMPT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump)]
    pub wager: UncheckedAccount<'info>,
}
#[derive(Accounts, Session)]
#[instruction(index: u64)]
pub struct UpdateQuestAttempt<'info> {
    #[account(mut, seeds = [ATTEMPT_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, QuestAttempt>,
    #[session(signer = signer, authority = wager.authority)]
    pub session_token: Option<Account<'info, SessionTokenV2>>,
    #[account(constraint = signer.key() == wager.authority || signer.key() == wager.session_signer)]
    pub signer: Signer<'info>,
}
#[vrf]
#[derive(Accounts, Session)]
#[instruction(index: u64)]
pub struct RiskQuest<'info> {
    #[account(mut, seeds = [ATTEMPT_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, QuestAttempt>,
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
pub struct ResolveQuest<'info> {
    #[account(mut, seeds = [ATTEMPT_SEED, wager.authority.as_ref(), &index.to_le_bytes()], bump = wager.bump)]
    pub wager: Account<'info, QuestAttempt>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct CancelQuestAttempt<'info> {
    #[account(mut, seeds = [ATTEMPT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, QuestAttempt>,
    pub authority: Signer<'info>,
}
#[commit]
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct FinalizeQuestAttempt<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [ATTEMPT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, QuestAttempt>,
}
#[derive(Accounts)]
#[instruction(index: u64)]
pub struct SettleQuestAttempt<'info> {
    #[account(mut, seeds = [QUEST_HOUSE_SEED], bump = house.bump)]
    pub house: Account<'info, QuestHouse>,
    #[account(mut, seeds = [QUEST_PLAYER_SEED, authority.key().as_ref()], bump = player.bump, has_one = authority)]
    pub player: Account<'info, QuestPlayer>,
    #[account(mut, seeds = [QUEST_TICKET_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = ticket.bump, has_one = authority)]
    pub ticket: Account<'info, QuestTicket>,
    // Account<T> requires original program ownership, rejecting still-delegated base accounts.
    #[account(seeds = [ATTEMPT_SEED, authority.key().as_ref(), &index.to_le_bytes()], bump = wager.bump, has_one = authority)]
    pub wager: Account<'info, QuestAttempt>,
    pub authority: Signer<'info>,
}
