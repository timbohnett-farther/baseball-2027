import { useEffect, useMemo, useState } from "react";
import {
  COSMETIC_SLOTS, LEGENDARY_MILESTONES, UNLOCK_STARS_BY_ITEM, woodDeltas,
  type BatLength, type BatWeight, type Cosmetics, type CosmeticSlot, type Gear, type MyTeam, type StoreState, type SuperBat, type Wood,
} from "@bb/shared";
import { TryOn } from "./tryon.tsx";
import { StarSummary } from "./arcade.tsx";
import { api } from "./api.ts";
import { ErrorNote, Loading, toast } from "./ui.tsx";

const WOODS: { wood: Wood; label: string; note: string }[] = [
  { wood: "ash", label: "Ash", note: "+1 Contact" },
  { wood: "maple", label: "Maple", note: "+1 Power" },
];
const CLASS_LABEL = { wood: "Wood", bbcor: "BBCOR", usssa: "USSSA" } as const;
const SWING_LABEL = { balanced: "Balanced", mid: "Mid-loaded", end: "End-loaded" } as const;
const BUILD_LABEL = { alloy: "One-piece alloy", composite: "Two-piece composite", hybrid: "Hybrid" } as const;
const SLOT_LABEL: Record<CosmeticSlot, { title: string; note: string }> = {
  helmet: { title: "Batting helmet", note: "Worn by whoever is up." },
  cleats: { title: "Cleats", note: "Every player on your club." },
  gloves: { title: "Batting gloves", note: "Worn by whoever is up." },
  jersey: { title: "Jersey style", note: "Every player on your club." },
  batskin: { title: "Bat skin", note: "Paints the bat your batter swings." },
  celebration: { title: "Home-run celebration", note: "Plays where a homer lands. Quiet with reduced motion." },
};
const LEDGER_LABEL: Record<string, string> = { game: "Game reward", tutorial: "Tutorial reward", season: "Season bonus", arcade: "Arcade stars and unlocks" };

/** What the try-on panel is showing: a slot's colourway (null = stock) or a Super Bat. */
type Sel = { slot: CosmeticSlot | "bat"; id: string | null };

type Ask = { id: string; name: string; price: number; bat: boolean };

/** Nothing is bought on a single tap: this sheet shows the item, its price and what is left, then asks. */
function ConfirmSheet({ ask, coins, busy, onCancel, onBuy }: { ask: Ask; coins: number; busy: boolean; onCancel: () => void; onBuy: () => void }) {
  const short = ask.price - coins;
  return (
    <div className="sheet-back" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Buy ${ask.name}`} onClick={(e) => e.stopPropagation()}>
        <h3>Buy {ask.name}?</h3>
        <dl className="sheet-rows">
          <div><dt>Price</dt><dd>{ask.price.toLocaleString()} coins</dd></div>
          <div><dt>You have</dt><dd>{coins.toLocaleString()} coins</dd></div>
          <div><dt>After buying</dt><dd>{short > 0 ? "–" : `${(coins - ask.price).toLocaleString()} coins`}</dd></div>
        </dl>
        {short > 0 && <p className="muted" role="status">Need {short.toLocaleString()} more coins</p>}
        <div className="sheet-actions">
          <button className="link" onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={short > 0 || busy} onClick={onBuy}>Buy</button>
        </div>
      </div>
    </div>
  );
}

/** Coins, the wood bat you swing every day, and the Super Power Bats you can buy or earn. */
export function StoreView() {
  const [store, setStore] = useState<StoreState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [teamColor, setTeamColor] = useState("#2e9e5b");

  const load = () => api<StoreState>("/api/store").then(setStore, (e: Error) => setError(e.message));
  useEffect(() => { load(); api<MyTeam>("/api/my-team").then((t) => setTeamColor(t.color), () => {}); }, []);
  const gear = store?.gear;
  // The preview is the worn gear with the tapped item swapped in; nothing is saved until Equip.
  const look = useMemo(() => {
    const cosmetics: Cosmetics = { ...(gear?.cosmetics ?? {}) };
    let superBat = gear?.superBat ?? null;
    if (sel?.slot === "bat") superBat = sel.id; else if (sel) cosmetics[sel.slot] = sel.id;
    return { color: teamColor, superBat, cosmetics };
  }, [gear, sel, teamColor]);

  const setGear = async (patch: Partial<Gear>) => {
    setError(null);
    try {
      const gear = await api<Gear>("/api/my-team/gear", { body: patch });
      setStore((s) => s && { ...s, gear });
    } catch (e) { setError((e as Error).message); }
  };
  const confirmBuy = async () => {
    if (!ask) return;
    setError(null); setBusy(ask.id);
    try {
      const r = await api<{ coins: number; batId?: string; itemId?: string }>("/api/store/buy", { body: ask.bat ? { batId: ask.id } : { cosmeticId: ask.id } });
      setStore((s) => s && { ...s, coins: r.coins, owned: [...s.owned, ask.id] });
      setSel({ slot: ask.bat ? "bat" : (store!.cosmetics.find((c) => c.id === ask.id)?.slot ?? "helmet"), id: ask.id });
      toast(ask.bat ? `${ask.name} is yours. ${r.coins.toLocaleString()} coins left.` : `${ask.name} added to your locker.`);
      load(); // the new purchase shows up in Recent coins
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); setAsk(null); }
  };

  if (error && !store) return <section className="panel"><ErrorNote message={error} onRetry={load} /></section>;
  if (!store) return <Loading label="Opening the store…" />;
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
      <ErrorNote message={error} onRetry={load} />

      <div className="tryon-dock">
        <TryOn look={look} />
        <TryBar sel={sel} store={store} busy={busy} onSet={setGear} onBuy={setAsk} />
      </div>

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

      <h3>Your look</h3>
      <p className="muted">Gear changes how your team looks, not how it plays. Tap anything to try it on; the stock look is always free.</p>
      {COSMETIC_SLOTS.map((slot) => {
        const worn = store.gear.cosmetics?.[slot] ?? null;
        return (
          <div key={slot} className="look-row">
            <div className="look-head"><b>{SLOT_LABEL[slot].title}</b><small className="muted">{SLOT_LABEL[slot].note}</small></div>
            <div className="swatches">
              <button className={`swatch stock ${worn ? "" : "on"} ${sel?.slot === slot && sel.id === null ? "peek" : ""}`} onClick={() => setSel({ slot, id: null })} title="Stock look">
                <span className="swatch-dot" /><span>Stock</span>
              </button>
              {store.cosmetics.filter((c) => c.slot === slot).map((c) => {
                const owned = store.owned.includes(c.id);
                const on = worn === c.id;
                const stars = UNLOCK_STARS_BY_ITEM[c.id];
                const locked = !owned && stars !== undefined;
                return (
                  <button key={c.id} className={`swatch tier-${c.tier} ${on ? "on" : ""} ${sel?.id === c.id ? "peek" : ""}`} title={c.name}
                    onClick={() => setSel({ slot, id: c.id })}>
                    <span className="swatch-dot" style={{ background: c.color }} />
                    <span>{c.name}</span>
                    <small>{on ? "Worn" : owned ? "Owned" : locked ? `Unlock at ${stars} stars` : `${c.price}`}</small>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <h3>Super Power Bats</h3>
      <p className="muted">Every Super Bat is a skin with its own look in the field. Tap a bat to try it on.</p>
      <div className="store-grid">
        {store.bats.map((b) => {
          const owned = store.owned.includes(b.id);
          const equipped = store.gear.superBat === b.id;
          const milestone = usual(b);
          return (
            <article key={b.id} className={`bat-card tier-${b.tier} ${equipped ? "equipped" : ""} ${sel?.id === b.id ? "peek" : ""}`} onClick={() => setSel({ slot: "bat", id: b.id })}>
              <div className="bat-top">
                <span className={`chip tier-chip`}>{b.tier}</span>
                <span className="chip">{CLASS_LABEL[b.cls]}</span>
              </div>
              <h4>{b.name}</h4>
              <small className="muted">by {b.maker}</small>
              <p className="bat-blurb">{b.blurb}</p>
              <dl className="bat-specs">
                <div><dt>Swing</dt><dd>{SWING_LABEL[b.swingWeight]}</dd></div>
                <div><dt>Build</dt><dd>{BUILD_LABEL[b.build]}</dd></div>
              </dl>
              <div className="bat-actions" onClick={(e) => e.stopPropagation()}>
                <button className="link" onClick={() => setSel({ slot: "bat", id: b.id })}>Try on</button>
                {equipped ? <button className="link" onClick={() => setGear({ superBat: null })}>Unequip</button>
                  : owned ? <button className="primary" onClick={() => setGear({ superBat: b.id })}>Equip</button>
                  : milestone ? <span className="chip">Unlock at {milestone} wins · {store.wins}/{milestone}</span>
                  : UNLOCK_STARS_BY_ITEM[b.id] !== undefined ? <span className="chip">Unlock at {UNLOCK_STARS_BY_ITEM[b.id]} stars</span>
                  : <button className="primary" disabled={busy === b.id} onClick={() => setAsk({ id: b.id, name: b.name, price: b.price, bat: true })}>
                      Buy · {b.price.toLocaleString()}
                    </button>}
                {equipped ? <span className="chip ready">Equipped</span> : owned && <span className="chip">Owned</span>}
              </div>
            </article>
          );
        })}
      </div>

      <h3>Recent coins</h3>
      {store.ledger.length === 0 ? <p className="muted">Nothing yet. Win a game or buy something and it shows up here.</p> : (
        <ul className="ledger">
          {store.ledger.map((l) => (
            <li key={l.id}>
              <span>{LEDGER_LABEL[l.kind] ?? `Bought ${itemName(store, l.itemId)}`}</span>
              <b className={l.delta < 0 ? "neg" : "pos"}>{l.delta > 0 ? "+" : ""}{l.delta.toLocaleString()}</b>
              <small className="muted">{l.balanceAfter.toLocaleString()} left</small>
            </li>
          ))}
        </ul>
      )}
      {ask && <ConfirmSheet ask={ask} coins={store.coins} busy={busy === ask.id} onCancel={() => setAsk(null)} onBuy={confirmBuy} />}
    </section>
  );
}

/** Under the preview: what is being tried on, and the separate Buy / Equip button. Tapping an item never buys or equips by itself. */
function TryBar({ sel, store, busy, onSet, onBuy }: { sel: Sel | null; store: StoreState; busy: string | null; onSet: (p: Partial<Gear>) => void; onBuy: (a: Ask) => void }) {
  if (!sel) return <p className="tryon-bar muted">Tap any item below to try it on.</p>;
  const bat = sel.slot === "bat";
  const item = sel.id === null ? null : bat ? store.bats.find((b) => b.id === sel.id) : store.cosmetics.find((c) => c.id === sel.id);
  const name = item?.name ?? "Stock look";
  const owned = sel.id === null || store.owned.includes(sel.id);
  const worn = bat ? store.gear.superBat === sel.id : (store.gear.cosmetics?.[sel.slot as CosmeticSlot] ?? null) === sel.id;
  const set = (id: string | null) => onSet(bat ? { superBat: id } : { cosmetics: { [sel.slot]: id } });
  const stars = sel.id ? UNLOCK_STARS_BY_ITEM[sel.id] : undefined;
  const milestone = bat && item ? LEGENDARY_MILESTONES.find((m) => m.batId === sel.id)?.wins : undefined;
  return (
    <div className="tryon-bar" role="status">
      <span><b>{name}</b> <small className="muted">{worn ? "Worn now" : owned ? "In your locker" : "Previewing"}</small></span>
      {owned ? (worn ? (sel.id !== null && <button className="link" onClick={() => set(null)}>Take off</button>) : <button className="primary" onClick={() => set(sel.id)}>Equip</button>)
        : milestone ? <span className="chip">Unlock at {milestone} wins</span>
        : stars !== undefined ? <span className="chip">Unlock at {stars} stars</span>
        : item && <button className="primary" disabled={busy === sel.id} onClick={() => onBuy({ id: sel.id!, name: item.name, price: item.price, bat })}>Buy · {item.price.toLocaleString()}</button>}
    </div>
  );
}

const itemName = (s: StoreState, id: string | null) => s.bats.find((b) => b.id === id)?.name ?? s.cosmetics.find((c) => c.id === id)?.name ?? "an item";

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
  const names: Record<string, string> = { result: "Game", shutout: "Shutout", homers: "Homers", comeback: "Comeback", streak: "Streak", season: "Season bonus", stars: "Stars", unlock: "Unlock" };
  const parts = Object.entries(reward.coins).filter(([, v]) => v > 0).map(([k, v]) => `${names[k] ?? k} ${v}`);
  return (
    <div className="reward">
      <span className="reward-total"><span className="coin" aria-hidden /> +{reward.total} coins</span>
      <small className="muted">{parts.join(" · ")}</small>
      {reward.arcade && <StarSummary arcade={reward.arcade} />}
      {reward.drop && <span className="chip ready">New Legendary bat: {reward.drop.name}</span>}
      {reward.levelUps?.map((u) => <span key={u.id} className="chip ready">{u.name} reached level {u.level}</span>)}
    </div>
  );
}
