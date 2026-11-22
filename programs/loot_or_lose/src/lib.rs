pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("4YqSeDXgqgmCDuRKMdyQhgU1cBHiRJEbktKD2TmhQ6tt");

#[program]
pub mod loot_or_lose {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
