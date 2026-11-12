import { useEffect, useState } from "react";
import {
  LEGENDARY_MILESTONES, woodDeltas,
  type BatLength, type BatWeight, type Gear, type StoreState, type SuperBat, type Wood,
} from "@bb/shared";
import { api } from "./api.ts";

const WOODS: { wood: Wood; label: string; note: string }[] = [
  { wood: "ash", label: "Ash", note: "+1 Contact" },
  { wood: "maple", label: "Maple", note: "+1 Power" },
];
const CLASS_LABEL = { wood: "Wood", bbcor: "BBCOR", usssa: "USSSA" } as const;
const SWING_LABEL = { balanced: "Balanced", mid: "Mid-loaded", end: "End-loaded" } as const;
const BUILD_LABEL = { alloy: "One-piece alloy", composite: "Two-piece composite", hybrid: "Hybrid" } as const;

/** Coins, the wood bat you swing every day, and the Super Power Bats you can buy or earn. */
export function StoreView() {
  const [store, setStore] = useState<StoreState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api<StoreState>("/api/store").then(setStore, (e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);

  const setGear = async (patch: Partial<Gear>) => {
    setError(null);
    try {
      const gear = await api<Gear>("/api/my-team/gear", { body: patch });
      setStore((s) => s && { ...s, gear });
    } catch (e) { setError((e as Error).message); }
  };
  const buy = async (bat: SuperBat) => {
    setError(null); setBusy(bat.id);
    try {
      const r = await api<{ coins: number; batId: string }>("/api/store/buy", { body: { batId: bat.id } });
      setStore((s) => s && { ...s, coins: r.coins, owned: [...s.owned, r.batId] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  if (error && !store) return <section className="panel"><p className="error">{error}</p></section>;
  if (!store) return <section className="panel"><p className="muted">Opening the store…</p></section>;
  const { wood } = store.gear;
  const d = woodDeltas(wood);
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const usual = (b: SuperBat) => b.tier === "legendary" ? LEGENDARY_MILESTONES.find((m) => m.batId === b.id)?.wins : null;

  return (
    <section className="panel store">
      <div className="store-head">
        <h2>Store</h2>
        <div className="coins"><span className="coin" aria-hidden /> <b>{store.coins.toLocaleString()}</b> coins</div>
      </div>
      <p className="muted">Win games to earn coins. Every win pays, shutouts and homers pay extra, and a streak keeps adding up.</p>
      {error && <p className="error">{error}</p>}

      <h3>Your wood bat</h3>
      <div className="wood">
        <Pick label="Wood" options={WOODS.map((w) => ({ v: w.wood, label: w.label, note: w.note }))} value={wood.wood}
          onPick={(v) => setGear({ wood: { ...wood, wood: v as Wood } })} />
        <Pick label="Length" options={[{ v: 33, label: '33"', note: "Quicker" }, { v: 34, label: '34"', note: "+1 Power −1 Contact" }]} value={wood.length}
          onPick={(v) => setGear({ wood: { ...wood, length: v as BatLength } })} />
        <Pick label="Weight" options={[{ v: 31, label: "31 oz", note: "Quicker" }, { v: 32, label: "32 oz", note: "+1 Power −1 Contact" }]} value={wood.weight}
          onPick={(v) => setGear({ wood: { ...wood, weight: v as BatWeight } })} />
        <div className="wood-sum">
          <span className="chip">{fmt(d.contact)} Contact</span>
          <span className="chip">{fmt(d.power)} Power</span>
          <small className="muted">Applies to your whole lineup. Free, always on.</small>
        </div>
      </div>

      <h3>Super Power Bats</h3>
      <p className="muted">Equip one. Each charge turns a clutch swing into a Super Swing: runners in scoring position, late innings, or two strikes.</p>
      <div className="store-grid">
        {store.bats.map((b) => {
          const owned = store.owned.includes(b.id);
          const equipped = store.gear.superBat === b.id;
          const milestone = usual(b);
          return (
            <article key={b.id} className={`bat-card tier-${b.tier} ${equipped ? "equipped" : ""}`}>
              <div className="bat-top">
                <span className={`chip tier-chip`}>{b.tier}</span>
                <span className="chip">{CLASS_LABEL[b.cls]}</span>
              </div>
              <h4>{b.name}</h4>
              <small className="muted">by {b.maker}</small>
              <p className="bat-blurb">{b.blurb}</p>
              <dl className="bat-specs">
                <div><dt>Charges</dt><dd>{b.charges} / game</dd></div>
                <div><dt>Super Swing</dt><dd>+{b.boost.power} Power · +{b.boost.contact} Contact</dd></div>
                <div><dt>Swing</dt><dd>{SWING_LABEL[b.swingWeight]}</dd></div>
                <div><dt>Build</dt><dd>{BUILD_LABEL[b.build]}</dd></div>
              </dl>
              <div className="bat-actions">
                {equipped ? <button className="link" onClick={() => setGear({ superBat: null })}>Unequip</button>
                  : owned ? <button className="primary" onClick={() => setGear({ superBat: b.id })}>Equip</button>
                  : milestone ? <span className="muted">Win {milestone} games to earn it · {store.wins}/{milestone}</span>
                  : <button className="primary" disabled={busy === b.id || store.coins < b.price} onClick={() => buy(b)}>
                      Buy · {b.price.toLocaleString()}
                    </button>}
                {equipped && <span className="chip ready">Equipped</span>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Pick<T extends string | number>({ label, options, value, onPick }: {
  label: string; options: { v: T; label: string; note: string }[]; value: T; onPick: (v: T) => void;
}) {
  return (
    <div className="pick">
      <span className="power-label">{label}</span>
      <div className="pick-row">
        {options.map((o) => (
          <button key={String(o.v)} className={`duel-type ${o.v === value ? "on" : ""}`} onClick={() => onPick(o.v)}>
            <b>{o.label}</b><small>{o.note}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** "+120 coins · Win 100 · Shutout 50 ..." under a final band. */
export function RewardLine({ reward }: { reward: NonNullable<import("@bb/sim").PlayedGame["reward"]> }) {
  const names: Record<string, string> = { result: "Game", shutout: "Shutout", homers: "Homers", comeback: "Comeback", streak: "Streak", season: "Season bonus" };
  const parts = Object.entries(reward.coins).filter(([, v]) => v > 0).map(([k, v]) => `${names[k] ?? k} ${v}`);
  return (
    <div className="reward">
      <span className="reward-total"><span className="coin" aria-hidden /> +{reward.total} coins</span>
      <small className="muted">{parts.join(" · ")}</small>
      {reward.drop && <span className="chip ready">New Legendary bat: {reward.drop.name}</span>}
    </div>
  );
}
