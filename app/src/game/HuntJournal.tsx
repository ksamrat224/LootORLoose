import { QUESTS } from "./hunt-rules";
import {
  BADGES,
  GUARDIANS,
  routeBadges,
  type DiscoveryProgress,
} from "./hunt-discovery";
export function HuntJournal({
  progress,
  mask,
  settled,
  persistent,
  live,
  onReplay,
}: {
  progress: DiscoveryProgress;
  mask: number;
  settled: boolean;
  persistent: boolean;
  live: boolean;
  onReplay: () => void;
}) {
  const eligible = routeBadges(mask);
  return (
    <div className="q-journal">
      <p className="q-small">
        {live ? "Devnet wallet" : "Practice"} discoveries · Local to this
        browser. These are cosmetic achievements, not onchain credentials. Every
        quest shares the same reward pool.
      </p>
      {!persistent && (
        <p role="status">
          Browser storage is unavailable. Discoveries cannot be saved; gameplay
          is unaffected.
        </p>
      )}
      <section aria-labelledby="journal-guardians">
        <h3 id="journal-guardians">
          Guardians discovered{" "}
          <span>
            {QUESTS.filter((q) => progress.unlocked & (1 << q.id)).length}/6
          </span>
        </h3>
        <div className="q-journal-entries">
          {QUESTS.map((q) => {
            const unlocked = !!(progress.unlocked & (1 << q.id));
            return (
              <article
                key={q.id}
                className={unlocked ? "is-discovered" : ""}
                style={{ borderLeftColor: GUARDIANS[q.id].color }}
              >
                <h4>{q.name}</h4>
                <p>{unlocked ? GUARDIANS[q.id].lore : q.description}</p>
                <span className="q-small">
                  {unlocked ? "Discovered" : "Undiscovered"}
                </span>
              </article>
            );
          })}
        </div>
      </section>
      <section aria-labelledby="journal-challenges">
        <h3 id="journal-challenges">Optional route challenges</h3>
        <p className="q-small">
          Choose your own route. Badges unlock after confirmed collection; they
          never change rewards or cost credits.
        </p>
        <div className="q-journal-entries">
          {BADGES.map((b) => {
            const earned = progress.badges.includes(b.id);
            const count = b.mask
              ? QUESTS.filter((q) => b.mask & mask & (1 << q.id)).length
              : Number(!!(mask & 25)) + Number(!!(mask & 38));
            return (
              <article key={b.id}>
                <h4>
                  {b.name} {earned && <span className="q-badge">Earned</span>}
                </h4>
                <p>{b.description}</p>
                <p className="q-small">
                  {eligible.includes(b.id)
                    ? settled
                      ? "Route completed this hunt."
                      : "Route complete · collect loot to earn."
                    : `This hunt: ${count}/${b.mask ? 3 : 2}`}
                </p>
              </article>
            );
          })}
        </div>
      </section>
      <button className="q-quiet" onClick={onReplay}>
        Replay guide
      </button>
    </div>
  );
}
