// Player ratings (40-99) built from real stats.
//
// 1. Combine recent seasons, newest weighted most (MLB 2026 > 2025 > 2024, Triple-A
//    counted at a discount and translated to MLB level).
// 2. Regress each rate toward a "fringe big-leaguer" baseline, more so for small samples,
//    so a hot 30 at-bats can't make anyone a 99.
// 3. Score each rate against MLB regulars: 70 = average regular, each standard
//    deviation = 10 points, clamped to 40-99.

export type Level = "MLB" | "AAA";

export interface HittingLine {
  pa: number; ab: number; h: number; doubles: number; triples: number; hr: number;
  bb: number; ibb: number; hbp: number; so: number; sb: number; cs: number;
}

export interface PitchingLine {
  bf: number; outs: number; g: number; gs: number; so: number; bb: number; hbp: number;
  hr: number; groundOuts: number; airOuts: number;
}

export interface Season<T> { year: number; level: Level; line: T }

export interface RatingInput {
  id: number;
  /** Primary position abbreviation (P, C, SS, DH, TWP, ...). */
  position: string;
  hitting: Season<HittingLine>[];
  pitching: Season<PitchingLine>[];
  /** Statcast sprint speed (ft/s) with competitive runs, by year. */
  sprint: { year: number; speed: number; runs: number }[];
  /** Fielding: Statcast outs above average and innings in the field, by year. */
  fielding: { year: number; oaa: number | null; innings: number; position: string; caughtStealing?: number; stolenBases?: number }[];
  /** Statcast average fastball velocity (mph), by year, with innings pitched. */
  velo: { year: number; mph: number; ip: number }[];
}

export interface HittingRatings { contact: number; power: number; eye: number; speed: number; fielding: number }
export interface PitchingRatings { stuff: number; control: number; movement: number; stamina: number }

export type Role = "H" | "SP" | "RP" | "TWP";

export interface PlayerRatings {
  id: number;
  overall: number;
  role: Role;
  hitting: HittingRatings | null;
  pitching: PitchingRatings | null;
  /** Weighted plate appearances / batters faced behind the ratings; small = mostly baseline. */
  sample: { pa: number; bf: number };
}

/** How much each season counts, relative to the latest MLB season. */
export function seasonWeight(year: number, level: Level, latest: number): number {
  const age = latest - year;
  const base = [1, 0.8, 0.6][age] ?? 0;
  return level === "AAA" ? base * 0.5 : base;
}

// Triple-A -> MLB translation, applied to counts before combining.
const AAA_HITTING = { h: 0.92, xbh: 0.85, hr: 0.75, bb: 0.9, so: 1.18, sb: 0.9 };
const AAA_PITCHING = { so: 0.85, bb: 1.12, hr: 1.3 };

// Sample size (PA or BF) at which a rate is regressed halfway to baseline.
const REGRESS = {
  hitter: { so: 80, bb: 150, hr: 250, iso: 250, avg: 600, sb: 200 },
  pitcher: { so: 100, bb: 200, hr: 400, gb: 150, outsPerG: 8 },
  sprintRuns: 15,
  oaaInnings: 300,
  veloIp: 20,
};

interface HitterRates { so: number; bb: number; hr: number; iso: number; avg: number; woba: number; sbRate: number; pa: number }
interface PitcherRates { so: number; bb: number; hr: number; gb: number; fip: number; outsPerG: number; startShare: number; bf: number }

function combineHitting(seasons: Season<HittingLine>[], latest: number) {
  const t = { pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, bb: 0, ibb: 0, hbp: 0, so: 0, sb: 0, cs: 0 };
  for (const { year, level, line } of seasons) {
    const w = seasonWeight(year, level, latest);
    if (!w) continue;
    const a = level === "AAA" ? AAA_HITTING : { h: 1, xbh: 1, hr: 1, bb: 1, so: 1, sb: 1 };
    t.pa += w * line.pa; t.ab += w * line.ab; t.h += w * line.h * a.h;
    t.doubles += w * line.doubles * a.xbh; t.triples += w * line.triples * a.xbh; t.hr += w * line.hr * a.hr;
    t.bb += w * line.bb * a.bb; t.ibb += w * line.ibb; t.hbp += w * line.hbp; t.so += w * line.so * a.so;
    t.sb += w * line.sb * a.sb; t.cs += w * line.cs;
  }
  return t;
}

function combinePitching(seasons: Season<PitchingLine>[], latest: number) {
  const t = { bf: 0, outs: 0, g: 0, gs: 0, so: 0, bb: 0, hbp: 0, hr: 0, groundOuts: 0, airOuts: 0 };
  for (const { year, level, line } of seasons) {
    const w = seasonWeight(year, level, latest);
    if (!w) continue;
    const a = level === "AAA" ? AAA_PITCHING : { so: 1, bb: 1, hr: 1 };
    t.bf += w * line.bf; t.outs += w * line.outs; t.g += w * line.g; t.gs += w * line.gs;
    t.so += w * line.so * a.so; t.bb += w * line.bb * a.bb; t.hbp += w * line.hbp; t.hr += w * line.hr * a.hr;
    t.groundOuts += w * line.groundOuts; t.airOuts += w * line.airOuts;
  }
  return t;
}

const regress = (count: number, n: number, baseline: number, k: number) => (count + baseline * k) / (n + k);

function hitterRates(c: ReturnType<typeof combineHitting>, base: HitterRates): HitterRates {
  const singles = c.h - c.doubles - c.triples - c.hr;
  const iso = c.ab > 0 ? (c.doubles + 2 * c.triples + 3 * c.hr) / c.ab : 0;
  const avg = c.ab > 0 ? c.h / c.ab : 0;
  const woba = c.pa > 0 ? (0.69 * (c.bb - c.ibb) + 0.72 * c.hbp + 0.89 * singles + 1.27 * c.doubles + 1.62 * c.triples + 2.1 * c.hr) / c.pa : 0;
  const onBase = c.h - c.doubles - c.triples - c.hr + c.bb + c.hbp;
  const r = REGRESS.hitter;
  return {
    pa: c.pa,
    so: regress(c.so, c.pa, base.so, r.so),
    bb: regress(c.bb - c.ibb, c.pa, base.bb, r.bb),
    hr: regress(c.hr, c.pa, base.hr, r.hr),
    iso: regress(iso * c.ab, c.ab, base.iso, r.iso),
    avg: regress(avg * c.ab, c.ab, base.avg, r.avg),
    woba: regress(woba * c.pa, c.pa, base.woba, r.iso),
    sbRate: regress(c.sb + c.cs, onBase, base.sbRate, r.sb),
  };
}

function pitcherRates(c: ReturnType<typeof combinePitching>, base: PitcherRates): PitcherRates {
  const ip = c.outs / 3;
  const fip = ip > 0 ? (13 * c.hr + 3 * (c.bb + c.hbp) - 2 * c.so) / ip : base.fip;
  const r = REGRESS.pitcher;
  return {
    bf: c.bf,
    so: regress(c.so, c.bf, base.so, r.so),
    bb: regress(c.bb, c.bf, base.bb, r.bb),
    hr: regress(c.hr, c.bf, base.hr, r.hr),
    gb: regress(c.groundOuts, c.groundOuts + c.airOuts, base.gb, r.gb),
    // FIP regressed by innings-equivalent (about 4.3 batters per inning).
    fip: regress(fip * ip, ip, base.fip, r.hr / 4.3),
    outsPerG: regress(c.outs, c.g, base.outsPerG, r.outsPerG),
    startShare: c.g > 0 ? c.gs / c.g : 0,
  };
}

interface Dist { mean: number; sd: number }
function dist(values: number[]): Dist {
  const mean = values.reduce((s, v) => s + v, 0) / Math.max(values.length, 1);
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1)) || 1;
  return { mean, sd };
}
const z = (v: number, d: Dist) => (v - d.mean) / d.sd;
export const toRating = (zScore: number, pointsPerSd = 10) => Math.max(40, Math.min(99, Math.round(70 + pointsPerSd * zScore)));
// Overall spreads a little less than individual skills so a 99 overall stays rare.
const OVERALL_POINTS_PER_SD = 8.5;

// Defensive value of each position, in z units added to a hitter's overall.
const POSITION_BONUS: Record<string, number> = { C: 0.35, SS: 0.35, CF: 0.25, "2B": 0.15, "3B": 0.15, RF: 0, LF: -0.05, OF: 0, "1B": -0.3, DH: -0.45, TWP: 0 };

const isPitcherPos = (pos: string) => pos === "P" || pos === "TWP";
const isHitterPos = (pos: string) => pos !== "P";

/** Rate a whole player pool at once (ratings are relative to MLB regulars in it). */
export function computeRatings(players: RatingInput[], latest: number): PlayerRatings[] {
  // Baselines: what a fringe big-leaguer does (MLB players with little playing time in the latest season).
  const fringeHit = combineHitting(players.flatMap((p) => p.hitting.filter((s) => s.level === "MLB" && s.year === latest && s.line.pa < 150 && isHitterPos(p.position))), latest);
  const fringePit = combinePitching(players.flatMap((p) => p.pitching.filter((s) => s.level === "MLB" && s.year === latest && s.line.outs < 120 && isPitcherPos(p.position))), latest);
  const zeroHit: HitterRates = { so: 0, bb: 0, hr: 0, iso: 0, avg: 0, woba: 0, sbRate: 0, pa: 0 };
  const zeroPit: PitcherRates = { so: 0, bb: 0, hr: 0, gb: 0, fip: 0, outsPerG: 0, startShare: 0, bf: 0 };
  const hitBase = hitterRates(fringeHit, zeroHit);
  const pitBase = pitcherRates(fringePit, zeroPit);

  const hit = new Map<number, HitterRates>();
  const pit = new Map<number, PitcherRates>();
  const speed = new Map<number, number | null>();
  const field = new Map<number, number | null>();
  const velo = new Map<number, number | null>();
  const sinceYear = latest - 2;

  for (const p of players) {
    if (isHitterPos(p.position)) {
      hit.set(p.id, hitterRates(combineHitting(p.hitting, latest), hitBase));

      const runs = p.sprint.filter((s) => s.year >= sinceYear);
      const w = runs.reduce((s, r) => s + seasonWeight(r.year, "MLB", latest) * r.runs, 0);
      const sum = runs.reduce((s, r) => s + seasonWeight(r.year, "MLB", latest) * r.runs * r.speed, 0);
      speed.set(p.id, w > 0 ? regress(sum, w, 27, REGRESS.sprintRuns) : null);

      if (p.position === "C") {
        // Catchers: caught-stealing rate, regressed toward 22%.
        const att = p.fielding.reduce((s, f) => s + seasonWeight(f.year, "MLB", latest) * ((f.caughtStealing ?? 0) + (f.stolenBases ?? 0)), 0);
        const cs = p.fielding.reduce((s, f) => s + seasonWeight(f.year, "MLB", latest) * (f.caughtStealing ?? 0), 0);
        field.set(p.id, att > 0 ? regress(cs, att, 0.22, 40) : null);
      } else {
        const rows = p.fielding.filter((f) => f.position !== "P" && f.year >= sinceYear);
        const inn = rows.reduce((s, f) => s + seasonWeight(f.year, "MLB", latest) * f.innings, 0);
        const oaa = rows.reduce((s, f) => s + seasonWeight(f.year, "MLB", latest) * (f.oaa ?? 0), 0);
        // OAA per 1,000 innings, regressed toward average (0).
        field.set(p.id, inn > 0 ? (regress(oaa, inn, 0, REGRESS.oaaInnings) * 1000) : null);
      }
    }
    if (isPitcherPos(p.position)) {
      pit.set(p.id, pitcherRates(combinePitching(p.pitching, latest), pitBase));
      const v = p.velo.filter((s) => s.year >= sinceYear);
      const w = v.reduce((s, r) => s + seasonWeight(r.year, "MLB", latest) * r.ip, 0);
      const sum = v.reduce((s, r) => s + seasonWeight(r.year, "MLB", latest) * r.ip * r.mph, 0);
      velo.set(p.id, w > 0 ? regress(sum, w, 93, REGRESS.veloIp) : null);
    }
  }

  // Score against regulars: hitters with 300+ weighted PA, pitchers with 150+ weighted BF.
  const regH = [...hit.entries()].filter(([, r]) => r.pa >= 300).map(([id, r]) => ({ id, r }));
  const regP = [...pit.entries()].filter(([, r]) => r.bf >= 150).map(([id, r]) => ({ id, r }));
  const posOf = new Map(players.map((p) => [p.id, p.position]));
  const d = {
    so: dist(regH.map((x) => x.r.so)), bb: dist(regH.map((x) => x.r.bb)), hr: dist(regH.map((x) => x.r.hr)),
    iso: dist(regH.map((x) => x.r.iso)), avg: dist(regH.map((x) => x.r.avg)), woba: dist(regH.map((x) => x.r.woba)),
    sb: dist(regH.map((x) => x.r.sbRate)),
    sprint: dist(regH.map((x) => speed.get(x.id)).filter((v): v is number => v != null)),
    oaa: dist(regH.filter((x) => posOf.get(x.id) !== "C").map((x) => field.get(x.id)).filter((v): v is number => v != null)),
    cs: dist(regH.filter((x) => posOf.get(x.id) === "C").map((x) => field.get(x.id)).filter((v): v is number => v != null)),
    pso: dist(regP.map((x) => x.r.so)), pbb: dist(regP.map((x) => x.r.bb)), phr: dist(regP.map((x) => x.r.hr)),
    gb: dist(regP.map((x) => x.r.gb)), fip: dist(regP.map((x) => x.r.fip)), opg: dist(regP.map((x) => x.r.outsPerG)),
    velo: dist(regP.map((x) => velo.get(x.id)).filter((v): v is number => v != null)),
  };

  const hitterZ = (id: number) => {
    const r = hit.get(id)!;
    const pos = posOf.get(id)!;
    const sp = speed.get(id);
    const speedZ = sp != null ? 0.8 * z(sp, d.sprint) + 0.2 * z(r.sbRate, d.sb) : 0.7 * z(r.sbRate, d.sb);
    const f = field.get(id);
    const fieldZ = pos === "DH" ? -2.5 : f == null ? -0.5 : pos === "C" ? z(f, d.cs) : z(f, d.oaa);
    const parts = {
      contact: 0.6 * -z(r.so, d.so) + 0.4 * z(r.avg, d.avg),
      power: 0.5 * z(r.iso, d.iso) + 0.5 * z(r.hr, d.hr),
      eye: z(r.bb, d.bb),
      speed: speedZ,
      fielding: fieldZ,
    };
    const overall = 0.8 * z(r.woba, d.woba) + 0.12 * Math.max(fieldZ, -1.5) + 0.08 * speedZ + (POSITION_BONUS[pos] ?? 0);
    return { parts, overall };
  };

  const pitcherZ = (id: number) => {
    const r = pit.get(id)!;
    const v = velo.get(id);
    const parts = {
      stuff: v != null ? 0.7 * z(r.so, d.pso) + 0.3 * z(v, d.velo) : z(r.so, d.pso),
      control: -z(r.bb, d.pbb),
      movement: 0.6 * -z(r.hr, d.phr) + 0.4 * z(r.gb, d.gb),
      stamina: z(r.outsPerG, d.opg),
    };
    const overall = -z(r.fip, d.fip) + 0.45 * parts.stamina;
    return { parts, overall };
  };

  // Rescale overall so it also reads 70 = average regular.
  const hOverall = dist(regH.map((x) => hitterZ(x.id).overall));
  const pOverall = dist(regP.map((x) => pitcherZ(x.id).overall));

  return players.map((p) => {
    const h = hit.has(p.id) ? hitterZ(p.id) : null;
    const pz = pit.has(p.id) ? pitcherZ(p.id) : null;
    const hitting = h && (p.position !== "TWP" || hit.get(p.id)!.pa > 0) ? {
      contact: toRating(h.parts.contact), power: toRating(h.parts.power), eye: toRating(h.parts.eye),
      speed: toRating(h.parts.speed), fielding: toRating(h.parts.fielding),
    } : null;
    const pitching = pz ? {
      stuff: toRating(pz.parts.stuff), control: toRating(pz.parts.control),
      movement: toRating(pz.parts.movement), stamina: toRating(pz.parts.stamina),
    } : null;
    const hOv = h ? toRating(z(h.overall, hOverall), OVERALL_POINTS_PER_SD) : 0;
    const pOv = pz ? toRating(z(pz.overall, pOverall), OVERALL_POINTS_PER_SD) : 0;
    const pr = pit.get(p.id);
    const role: Role = p.position === "TWP" ? "TWP" : pz ? (pr!.startShare >= 0.5 || (pr!.bf === 0 && pr!.outsPerG > 9) ? "SP" : "RP") : "H";
    return {
      id: p.id,
      overall: role === "TWP" ? Math.min(99, Math.max(hOv, pOv) + 4) : Math.max(hOv, pOv),
      role,
      hitting,
      pitching,
      sample: { pa: Math.round(hit.get(p.id)?.pa ?? 0), bf: Math.round(pr?.bf ?? 0) },
    };
  });
}
