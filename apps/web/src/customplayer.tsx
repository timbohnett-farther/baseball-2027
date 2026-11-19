import { useMemo, useState } from "react";
import {
  ACCENT_COLORS, BUILDS, CUSTOM_POSITIONS, SKIN_TONES, customOverall, defaultRatings, isPitcherPosition, pointsSpent, skillsFor, validateCustomPlayer,
  type Bats, type Build, type CustomPlayerInput, type CustomPlayerState, type CustomPosition, type MyTeam,
} from "@bb/shared";
import { api } from "./api.ts";
import { TryOn } from "./tryon.tsx";
import { ErrorNote, toast } from "./ui.tsx";

const SKIN_HEX = ["#f0c8a4", "#d9a77c", "#b97f57", "#8c5a3c", "#5e3b25"];
const SKILL_LABEL: Record<string, string> = { contact: "Contact", power: "Power", eye: "Eye", speed: "Speed", fielding: "Fielding", stuff: "Stuff", control: "Control", movement: "Movement", stamina: "Stamina" };
const NO_GEAR = {};
const STEPS = ["You", "Look", "Ratings", "Review"];

const blank = (): CustomPlayerInput => ({ name: "", number: 7, position: "DH", bats: "R", look: { skin: 1, build: "regular", accent: 1 }, ratings: defaultRatings("DH") });

/** Create or edit the team's one custom player: who he is, how he looks, where the points go. The server checks every rule again. */
export function CustomPlayerFlow({ state, teamColor, onSaved, onCancel }: { state: CustomPlayerState; teamColor: string; onSaved: (t: MyTeam) => void; onCancel: () => void }) {
  const editing = state.player !== null;
  const [step, setStep] = useState(0);
  const [p, setP] = useState<CustomPlayerInput>(state.player ?? blank());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CustomPlayerInput>) => setP((x) => ({ ...x, ...patch }));

  const pitcher = isPitcherPosition(p.position);
  const budget = (pitcher ? state.points.base.pitcher : state.points.base.hitter) + state.points.bonus;
  const spent = pointsSpent(p.ratings, p.position);
  const left = budget - spent;
  const check = useMemo(() => validateCustomPlayer(p, state.points.stars), [p, state.points.stars]);

  const pickPosition = (position: CustomPosition) =>
    setP((x) => ({ ...x, position, ratings: isPitcherPosition(position) === isPitcherPosition(x.position) ? x.ratings : defaultRatings(position) }));
  const bump = (skill: string, d: number) => setP((x) => {
    const v = (x.ratings[skill] ?? state.points.floor) + d;
    if (v < state.points.floor || v > state.points.cap || (d > 0 && pointsSpent(x.ratings, x.position) >= budget)) return x;
    return { ...x, ratings: { ...x.ratings, [skill]: v } };
  });

  const nameOk = check.problems.find((m) => /name|letters|2 to 16|characters/i.test(m));
  const numberOk = Number.isInteger(p.number) && p.number >= 0 && p.number <= 99;

  async function save() {
    setBusy(true); setError(null);
    try {
      const t = await api<MyTeam>("/api/my-team/custom-player", { method: editing ? "PATCH" : "POST", body: p });
      toast(editing ? "Player updated." : "Your player joined the team.");
      onSaved(t);
    } catch (e) { setError((e as Error).message); toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }

  const look = useMemo(() => ({ color: teamColor, superBat: null, cosmetics: NO_GEAR }), [teamColor]);
  const preview = useMemo(() => ({ skin: p.look.skin, build: p.look.build, accent: ACCENT_COLORS[p.look.accent], number: p.number }), [p.look.skin, p.look.build, p.look.accent, p.number]);

  return (
    <section className="panel narrow create-player">
      <h2>{editing ? "Edit your player" : "Create your player"}</h2>
      <ol className="steps" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>{i + 1}. {s}</li>)}
      </ol>

      {step === 0 && (
        <div className="form">
          <label>Name <small className="muted">A nickname works great</small>
            <input value={p.name} onChange={(e) => set({ name: e.target.value })} maxLength={16} placeholder="Sky Blue" autoComplete="off" />
          </label>
          {p.name !== "" && nameOk && <p className="error" role="alert">{nameOk}</p>}
          <label>Jersey number (0 to 99)
            <input type="number" inputMode="numeric" min={0} max={99} value={p.number} onChange={(e) => set({ number: e.target.value === "" ? NaN : Math.round(Number(e.target.value)) })} />
          </label>
          <div>
            <span className="label">Position</span>
            <div className="choices" role="radiogroup" aria-label="Position">
              {CUSTOM_POSITIONS.map((c) => <button type="button" key={c} role="radio" aria-checked={p.position === c} className={`choice ${p.position === c ? "on" : ""}`} onClick={() => pickPosition(c)}>{c}</button>)}
            </div>
          </div>
          <div>
            <span className="label">{pitcher ? "Throws" : "Bats"}</span>
            <div className="choices" role="radiogroup" aria-label="Handedness">
              {([["L", "Left"], ["R", "Right"], ["S", "Switch"]] as [Bats, string][]).filter(([b]) => !(pitcher && b === "S")).map(([b, t]) => (
                <button type="button" key={b} role="radio" aria-checked={p.bats === b} className={`choice ${p.bats === b ? "on" : ""}`} onClick={() => set({ bats: b })}>{t}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="form">
          <TryOn look={look} custom={preview} />
          <div>
            <span className="label">Skin tone</span>
            <div className="colors">
              {SKIN_HEX.slice(0, SKIN_TONES).map((c, i) => <button type="button" key={c} className={`color ${p.look.skin === i ? "on" : ""}`} style={{ background: c }} aria-label={`Skin tone ${i + 1}`} aria-pressed={p.look.skin === i} onClick={() => set({ look: { ...p.look, skin: i } })} />)}
            </div>
          </div>
          <div>
            <span className="label">Build</span>
            <div className="choices">
              {BUILDS.map((b: Build) => <button type="button" key={b} className={`choice ${p.look.build === b ? "on" : ""}`} aria-pressed={p.look.build === b} onClick={() => set({ look: { ...p.look, build: b } })}>{b[0].toUpperCase() + b.slice(1)}</button>)}
            </div>
          </div>
          <div>
            <span className="label">Uniform accent <small className="muted">cap and sleeves</small></span>
            <div className="colors">
              {ACCENT_COLORS.map((c, i) => <button type="button" key={c} className={`color ${p.look.accent === i ? "on" : ""}`} style={{ background: c }} aria-label={`Accent ${i + 1}`} aria-pressed={p.look.accent === i} onClick={() => set({ look: { ...p.look, accent: i } })} />)}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="form">
          <p className="points" role="status"><b>{left}</b> points left <span className="muted small">of {budget}</span></p>
          <p className="muted small">
            {state.points.stars} lifetime stars gives +{state.points.bonus} bonus points{state.nextBonus ? `; ${state.nextBonus.stars} stars gives +${state.nextBonus.bonus}` : " (the most there is)"}.
            No rating goes above {state.points.cap}. Points can't be bought.
          </p>
          <ul className="rate-list">
            {skillsFor(p.position).map((k) => {
              const v = p.ratings[k] ?? state.points.floor;
              return (
                <li key={k} className="rate-row">
                  <span className="rate-name">{SKILL_LABEL[k] ?? k}</span>
                  <button type="button" className="step-btn" aria-label={`Lower ${SKILL_LABEL[k]}`} disabled={v <= state.points.floor} onClick={() => bump(k, -1)}>−</button>
                  <span className="rate-val" aria-live="polite">{v}</span>
                  <button type="button" className="step-btn" aria-label={`Raise ${SKILL_LABEL[k]}`} disabled={v >= state.points.cap || left <= 0} onClick={() => bump(k, 1)}>+</button>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Overall {customOverall(p.ratings, p.position)}</p>
        </div>
      )}

      {step === 3 && (
        <div className="form">
          <dl className="sheet-rows">
            <div><dt>Name</dt><dd>{p.name}</dd></div>
            <div><dt>Number</dt><dd>#{p.number}</dd></div>
            <div><dt>Position</dt><dd>{p.position} · {pitcher ? "throws" : "bats"} {p.bats === "L" ? "left" : p.bats === "R" ? "right" : "both"}</dd></div>
            <div><dt>Overall</dt><dd>{customOverall(p.ratings, p.position)}</dd></div>
            {skillsFor(p.position).map((k) => <div key={k}><dt>{SKILL_LABEL[k]}</dt><dd>{p.ratings[k]}</dd></div>)}
          </dl>
          {check.problems.length > 0 && <ul className="needs">{check.problems.map((m) => <li key={m}>{m}</li>)}</ul>}
          {!editing && <p className="muted small">He takes one of your 12 roster spots.</p>}
          <ErrorNote message={error} />
        </div>
      )}

      <div className="flow-actions">
        <button type="button" className="link" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>{step === 0 ? "Cancel" : "Back"}</button>
        {step < 3
          ? <button type="button" className="primary" disabled={step === 0 && (!!nameOk || p.name.trim() === "" || !numberOk)} onClick={() => setStep(step + 1)}>{step === 2 ? "Review" : "Next"}</button>
          : <button type="button" className="primary" disabled={busy || check.problems.length > 0} onClick={save}>{editing ? "Save changes" : "Save player"}</button>}
      </div>
    </section>
  );
}

/** Tapping the × never drops anyone by itself: this sheet asks first. */
export function DropSheet({ name, note, busy, onCancel, onDrop }: { name: string; note: string; busy: boolean; onCancel: () => void; onDrop: () => void }) {
  return (
    <div className="sheet-back" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`Drop ${name}`} onClick={(e) => e.stopPropagation()}>
        <h3>Drop {name}?</h3>
        <p className="muted">{note}</p>
        <div className="sheet-actions">
          <button className="link" onClick={onCancel}>Keep</button>
          <button className="primary" disabled={busy} onClick={onDrop}>Drop</button>
        </div>
      </div>
    </div>
  );
}
