// Pure helpers for the tap-only duel controls (ARC 4-6, 9; PUP 12). No React, so they run under node --test.
import type { Aim, AbilityRequest, AbilityStatus } from "@bb/sim";

export type Approach = "contact" | "power";

/** The 3x3 pitch grid in reading order (top-left = 0). Edge cells sit on the border of the zone; "chase" pushes the ring off the plate. */
const EDGE = 0.85, CHASE = 1.4;
export function cellAim(index: number, chase = false): Aim {
  const col = (index % 3) - 1, row = 1 - Math.floor(index / 3);
  const r = chase ? CHASE : EDGE;
  return { x: col * r, y: row * r };
}
export function cellTag(index: number, chase = false): "MIDDLE" | "EDGE" | "CHASE" {
  return index === 4 ? "MIDDLE" : chase ? "CHASE" : "EDGE";
}
/** Keys 1-9 aim like a numpad: 7 8 9 on top. */
const NUMPAD = "789456123";
export const keyCell = (key: string): number => NUMPAD.indexOf(key);

export const APPROACH_TEXT: Record<Approach, string> = {
  contact: "CONTACT: EASIER TO CONNECT",
  power: "POWER: BIGGER RISK, BIGGER HIT",
};

/** One glyph per ability so a chip never relies on colour alone (PUP 12.1). */
export const ABILITY_ICON: Record<string, string> = {
  BAT_COMET: "☄", BAT_LASER: "━", BAT_GAP_MASTER: "⇔", BAT_SECOND_SWING: "↻", PITCH_MIRAGE: "?", PITCH_VORTEX: "@",
  FIELD_WALL_REAPER: "▲", FIELD_ACROBAT: "✦", FIELD_CANNON_ARM: "➤",
};

export interface ChipCtx {
  /** What is armed right now (this panel only; it never outlives the pitch). */
  armed: AbilityRequest | null;
  /** Heat the athlete has, before any reservation. */
  heat: number;
  /** Selected approach when batting; null when pitching. */
  approach: Approach | null;
  /** An ability waiting for a left/right choice. */
  choosing: string | null;
}

/** ARC 9.5 touch labels, one reason per chip. */
export function reasonText(a: AbilityStatus, heat: number): string {
  switch (a.reason) {
    case "COOLDOWN": return `READY IN ${/\d+/.exec(a.message ?? "")?.[0] ?? "A FEW"} PITCHES`;
    case "INSUFFICIENT_HEAT": return `NEED ${Math.max(1, a.cost - Math.floor(heat))} MORE HEAT`;
    case "SELECT_DIRECTION": return "CHOOSE LEFT OR RIGHT";
    case "ALREADY_USED": return "ALREADY USED THIS MATCH / PLAY";
    case "WRONG_SWING": return `${(a.swings[0] ?? "right").toUpperCase()} SWING REQUIRED`;
    case "INELIGIBLE_ACTOR": return "NOT THIS PLAYER";
    default: return "NOT AVAILABLE NOW";
  }
}

const misfit = (a: AbilityStatus, approach: Approach | null) => approach !== null && a.swings.length > 0 && !a.swings.includes(approach);

export type ChipState = "ready" | "armed" | "choosing" | "disabled";
export function chipState(a: AbilityStatus, c: ChipCtx): { state: ChipState; label: string } {
  if (c.armed?.id === a.id) {
    const d = c.armed.direction;
    return { state: "armed", label: d ? `ARMED ${d.toUpperCase()}` : "ARMED" };
  }
  if (c.choosing === a.id) return { state: "choosing", label: "CHOOSE LEFT OR RIGHT" };
  if (!a.available) return { state: "disabled", label: reasonText(a, c.heat) };
  return { state: "ready", label: "ARM" };
}

export type ChipAction =
  | { do: "arm"; req: AbilityRequest }
  | { do: "cancel" }
  | { do: "choose"; id: string }
  | { do: "note"; text: string }
  /** Wrong swing selected: say so and offer one button that selects the right one and arms. */
  | { do: "switch"; to: Approach; text: string };

export function chipTap(a: AbilityStatus, c: ChipCtx): ChipAction {
  if (c.armed?.id === a.id) return { do: "cancel" };
  if (!a.available) return { do: "note", text: reasonText(a, c.heat) };
  if (misfit(a, c.approach)) return { do: "switch", to: a.swings[0], text: `${a.swings[0].toUpperCase()} SWING REQUIRED` };
  if (a.needsDirection) return { do: "choose", id: a.id };
  return { do: "arm", req: { id: a.id } };
}

/** Changing approach while armed releases an ability the new swing cannot carry. */
export function survivesApproach(a: AbilityStatus | undefined, approach: Approach): boolean {
  return !a || !misfit(a, approach);
}
