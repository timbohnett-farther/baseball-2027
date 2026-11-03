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
