// Three-letter team abbreviations for user teams (scorebug, line score).

// Combinations that must never appear on a scorebug. Checked after building the abbreviation.
const BLOCKED = new Set([
  "NIG", "NGR", "NGA", "FAG", "KKK", "ASS", "SEX", "FUK", "FUC", "FCK", "FKU", "DIK", "DIC", "COK", "CUM", "TIT",
  "PUS", "PIS", "POO", "PEE", "WTF", "STD", "HOE", "SHT", "SUK", "SUX", "JIZ", "WOP", "SPK", "CNT", "KUM", "XXX",
]);

/** "Night Owls" -> "NOW", "Thunder Sluggers" -> "TSL", "Bombers" -> "BOM". Never a blocked combination. */
export function teamAbbreviation(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "YOU";
  const last = words[words.length - 1];
  const candidates: string[] = [];
  if (words.length >= 2) {
    const initials = words.map((w) => w[0]).join("").slice(0, 3);
    candidates.push((initials + last.slice(1)).slice(0, 3));
    candidates.push((words[0][0] + last.slice(0, 2)).slice(0, 3));
  }
  candidates.push(words[0].slice(0, 3), last.slice(0, 3), (words[0][0] + (words[0][2] ?? "") + (words[0][4] ?? "")).slice(0, 3));
  return candidates.find((c) => c.length >= 2 && !BLOCKED.has(c)) ?? "YOU";
}

/** Longer words that are never allowed in a display name (matched against the letters only, so spacing tricks fail). */
const BLOCKED_WORDS = ["NIGGER", "NIGGA", "FAGGOT", "FUCK", "SHIT", "BITCH", "PENIS", "VAGINA", "CUNT", "WHORE", "SLUT", "RAPE", "NAZI", "HITLER", "PORN"];

export type NameCheck = { ok: true; name: string } | { ok: false; reason: string };

/** A kid's player name or nickname: 2-16 letters, digits, spaces, dots, dashes, apostrophes. Blocklist applied. */
export function validateDisplayName(raw: unknown): NameCheck {
  if (typeof raw !== "string") return { ok: false, reason: "Give your player a name." };
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 16) return { ok: false, reason: "Name must be 2 to 16 characters." };
  if (!/^[A-Za-z0-9][A-Za-z0-9 .'-]*$/.test(name)) return { ok: false, reason: "Use letters, numbers, spaces, dots, dashes or apostrophes." };
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters) return { ok: false, reason: "Use at least one letter." };
  const tokens = name.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  if (tokens.some((t) => BLOCKED.has(t)) || BLOCKED.has(letters) || BLOCKED_WORDS.some((w) => letters.includes(w))) {
    return { ok: false, reason: "Pick a different name." };
  }
  return { ok: true, name };
}
