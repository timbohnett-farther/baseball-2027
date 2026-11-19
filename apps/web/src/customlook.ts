// The look of the team's custom player, keyed by his (negative) sim id, so the 3D rig can dress him
// without the sim or the game snapshot knowing anything about looks.
import { ACCENT_COLORS, type Build, type MyTeam } from "@bb/shared";

export interface CustomLookInfo { skin: number; build: Build; accent: string; number: number }

const looks = new Map<number, CustomLookInfo>();

/** Remember (or forget) the custom player on the signed-in user's team. */
export function registerCustomLook(team: MyTeam | null) {
  looks.clear();
  for (const p of team?.players ?? []) {
    if (p.custom) looks.set(p.id, { skin: p.custom.look.skin, build: p.custom.look.build as Build, accent: ACCENT_COLORS[p.custom.look.accent] ?? ACCENT_COLORS[0], number: p.custom.number });
  }
}

export const customLookOf = (id: number | null | undefined): CustomLookInfo | undefined => (id == null ? undefined : looks.get(id));

/** Rig width multiplier per build preset (height stays put, so the figure never clips the dugout). */
export const BUILD_SCALE: Record<Build, number> = { slim: 0.9, regular: 1, sturdy: 1.12 };
