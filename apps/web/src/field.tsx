import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { GameEvent, PlayedGame, Side, SimPlayer, SimTeam } from "@bb/sim";
import { COSMETIC_BY_ID, type CosmeticSlot } from "@bb/shared";
import { cosmeticRng, SHOT_SEED } from "./cosmetic.ts";
import { getQuality, QUALITY_PROFILE } from "./quality.ts";
import { blendRate, blockingBudgetMs, cameraViewFor, fitShots, type CameraView } from "./presentation.ts";
import { holdWithShot, shotPose, type ActionShotDirector, type ShotPlan } from "./actionshot.ts";
import {
  BALL_RADIUS, BALL_SCALE, CONTACT_Q, batSide, RELEASE_Q, SLIDER_HIP, SLIDER_TILT, TransformRecorder, contactPose, contactScene, fielderPose, fitFov, mirrorPose, pitchTarget,
  releasePose, releaseScene, throwIndex, contactBall, tagPoint, FIELDER_BACK, type Hand, slideScene, slideSubject, sliderPose, type Placement, type SlideSubject,
} from "./shotscene.ts";
import { applyPose, handWorld, makeShotFigure, reachTo } from "./shotfigure.ts";
import { limb, mergeByMaterial } from "./rigutil.ts";

// 3D ballpark that animates the sim's event stream (docs/ARCHITECTURE.md "Graphics and big moments").
// Everything is procedural low-poly: dark navy-black world, one warm key light, a rim light from
// behind-right, dust in the air (docs/VISUAL_DESIGN.md sections 1, 3 and 7). Units are metres, home plate
// at the origin, the outfield toward -z, first base to the right.

type Play = Extract<GameEvent, { type: "play" }>;
/** `?shot=...` art-review pages publish the plate's screen rect (see publishStrikeZone). */
const SHOT_MODE = typeof location !== "undefined" && location.search.includes("shot=");
/** Art review only (`&hold=0.5`): freeze an action shot at that fraction of its run so early/mid/late can be captured deterministically. */
/** The sim has no pitcher throwing hand, so presentation defaults to right-handed; the capture harness can force `?throws=L`. */
const SHOT_THROWS: Hand = SHOT_MODE && /[?&]throws=L/.test(location.search) ? "L" : "R";
const SHOT_HOLD = SHOT_MODE ? (() => { const m = /[?&]hold=([\d.]+)/.exec(location.search); return m ? Math.min(1, Math.max(0, Number(m[1]))) : null; })() : null;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FT = 0.3048;
const BASES = [V(0, 0, 0), V(19.4, 0, -19.4), V(0, 0, -38.8), V(-19.4, 0, -19.4)]; // home, 1B, 2B, 3B
const WALL_R = 112;
// pitcher, catcher, 1B, 2B, SS, 3B, LF, CF, RF
const FIELD_POS = [V(0, 0, -18.4), V(0, 0, 2.2), V(17, 0, -24), V(8, 0, -35), V(-8, 0, -35), V(-17, 0, -24), V(-34, 0, -66), V(0, 0, -80), V(34, 0, -66)];
const HOME_LOOK = V(0, 1.2, -26);
const FREEZE = 0.35; // contact freeze (s, real time) for tier 1-2 plays

/** Plate-crossing point (metres, x across, y height) from a recorded pitch location; the zone is -1..1 and the strike zone is about 0.45 m wide and 0.5-1.1 m high. */
const pitchSpot = (s: { x: number; y: number }): [number, number] => [s.x * 0.24, Math.max(0.1, 0.8 + s.y * 0.3)];
/** Field angle (0 = straight to centre, + = first-base side) for a recorded spray: 0 left line .. 1 right line. */
const sprayAngle = (spray: number) => (spray - 0.5) * 1.5;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const rnd = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const polar = (r: number, a: number) => V(Math.sin(a) * r, 0, -Math.cos(a) * r);

interface Tween { t: number; delay: number; dur: number; fn: (p: number) => void; end?: () => void }

// The named cameras of VISUAL_DESIGN 3.3. A big play queues a shot list; each shot runs on the
// shot clock (playback seconds) and may slow or freeze the action under it. An empty queue is the
// gameplay camera. `ride` ends early once the ball lands.
type ShotKind = "barrel" | "dust" | "ride" | "drive" | "hero" | "dive" | "contact" | "release" | "slide" | "broadcast";
interface Shot { kind: ShotKind; dur: number; scale?: number | ((t: number) => number); target?: THREE.Object3D | null; still?: boolean; base?: number; side?: 1 | -1 }
const RAMP = (t: number) => 0.25 + Math.min(1, t / 0.6) * 0.75; // slow-mo easing back to full speed
const barrel = (dur = FREEZE): Shot => ({ kind: "barrel", dur, scale: 0 });
const dust = (dur: number): Shot => ({ kind: "dust", dur, scale: 0.25 });
const ride = (dur: number): Shot => ({ kind: "ride", dur, scale: RAMP });
const on = (kind: "drive" | "hero" | "dive", target: THREE.Object3D | null, dur: number, scale = 1): Shot => ({ kind, dur, target, scale });

function softSprite(color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Checker-mown outfield: straight stripes with a faint cross pass. */
function grassTexture(repeat: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#2f6b3c" : "#397c47"; g.fillRect(i * 64, 0, 64, 512); }
  g.fillStyle = "rgba(0,0,0,0.07)";
  for (let i = 0; i < 8; i += 2) g.fillRect(0, i * 64, 512, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

/** Signage texture: condensed caps on a flat panel. Names are the game's own fictional makers. */
function signTexture(text: string, bg: string, fg: string, w = 1024, h = 160): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const font = (px: number) => `600 ${Math.round(px)}px Oswald, "Arial Narrow", sans-serif`;
  let px = h * 0.62;
  g.font = font(px);
  const tw = g.measureText(text).width;
  if (tw > w * 0.9) { px *= (w * 0.9) / tw; g.font = font(px); } // long names shrink to fit the panel
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PLAYER_SCALE = 1;
const SKIN = ["#f0c8a4", "#d9a77c", "#b97f57", "#8c5a3c", "#5e3b25"];
const std = (color: string, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
/** Fielder slot -> lineup position label (FIELD_POS order). */
const SLOT_POS = ["P", "C", "1B", "2B", "SS", "3B", "LF", "CF", "RF"];
/** Jersey numbers aren't in the data; derive a stable one from the player id. */
const jerseyNumber = (p: SimPlayer) => 2 + ((p.id * 37) % 97);

const jerseys = new Map<string, THREE.CanvasTexture>();
/**
 * Jersey texture for the torso capsule: team colour, pinstripes for every other club, a name arc over a big
 * number on the back (drawn mirrored, since the capsule's u axis runs toward the player's left) and a small
 * number on the left chest. u=0 is the chest, u=0.5 the spine; v runs bottom to top.
 */
function jerseyTexture(team: SimTeam, player: SimPlayer | null): THREE.CanvasTexture {
  const key = `${team.abbr}|${player?.id ?? ""}`;
  const hit = jerseys.get(key);
  if (hit) return hit;
  const w = 1024, h = 512;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  const base = new THREE.Color(team.color);
  const light = base.r * 0.3 + base.g * 0.59 + base.b * 0.11 > 0.35;
  const fg = light ? "#121418" : "#f4f1ea";
  g.fillStyle = `#${base.getHexString()}`; g.fillRect(0, 0, w, h);
  const pin = [...team.abbr].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 2 === 1;
  if (pin) {
    g.fillStyle = light ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.28)";
    for (let x = 6; x < w; x += 26) g.fillRect(x, 0, 3, h);
  }
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
  if (player) {
    const num = String(jerseyNumber(player));
    g.save(); g.translate(w / 2, 0); g.scale(-1, 1); // back of the jersey reads correctly from behind
    g.font = `700 150px Oswald, "Arial Narrow", sans-serif`;
    g.fillText(num, 0, h * 0.5);
    const name = player.lastName.toUpperCase(), r = 230, step = 0.085;
    g.font = `600 44px Oswald, "Arial Narrow", sans-serif`;
    let a = -step * (name.length - 1) / 2;
    for (const ch of name) {
      g.save(); g.translate(Math.sin(a) * r, h * 0.56 - Math.cos(a) * r); g.rotate(a); g.fillText(ch, 0, 0); g.restore();
      a += step;
    }
    g.restore();
    g.font = `700 56px Oswald, "Arial Narrow", sans-serif`;
    g.fillText(num, w * 0.085, h * 0.3); // left chest
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  jerseys.set(key, t);
  return t;
}

/**
 * Pro-proportioned player, 1.85 m, built in a local frame facing +z: team-colour jersey and cap, white pants,
 * belt and cleats, posed limbs. Batters get a helmet, a bat held at the back shoulder and the frame turned to
 * face the plate (right-handed). Fielders get a glove. Generic faces only, no likenesses.
 */
function makePlayer(color: THREE.Color, bat = false, seed = 0, ump = false): THREE.Group {
  const g = new THREE.Group();
  const rig = new THREE.Group();
  rig.name = "rig";
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const capMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.55 });
  const pants = std(ump ? "#7d8089" : "#ecebe4"), skin = std(SKIN[seed % SKIN.length], 0.65), dark = std("#1a1a1e", 0.6);
  // Cosmetic slots (W14): cleats, batting helmet and batting gloves get their own materials so a bought colourway can be painted on.
  const cleatMat = std("#1a1a1e", 0.6);
  const helmetMat = bat ? new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.8), roughness: 0.4 }) : capMat;
  const gloveMat = bat ? std(SKIN[seed % SKIN.length], 0.65) : skin;

  for (const s of [-1, 1]) {
    const hip = V(s * 0.12, 0.96, 0), knee = V(s * 0.17, 0.52, bat ? 0.04 : 0.06), foot = V(s * (bat ? 0.3 : 0.19), 0.07, bat ? 0 : 0.04);
    const ankle = foot.clone().lerp(knee, 0.3); // pants stop here, the stirrup sock runs to the cleat
    rig.add(limb(hip, knee, 0.085, pants, 0.072), limb(knee, ankle, 0.072, pants, 0.06), limb(ankle, foot, 0.06, ump ? dark : capMat, 0.052));
    const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.29), cleatMat);
    cleat.position.set(foot.x, 0.04, foot.z + 0.05); cleat.castShadow = true; rig.add(cleat);
  }
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 6, 14), bodyMat);
  torso.position.y = 1.25; torso.castShadow = true;
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.185, 0.06, 14), dark);
  belt.position.y = 0.98;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), skin);
  neck.position.y = 1.57;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 16), skin);
  head.position.y = 1.69; head.castShadow = true;
  rig.add(torso, belt, neck, head);

  // Headgear: fitted cap with a brim, or a batting helmet with the ear flap toward the pitcher.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(bat ? 0.13 : 0.122, 20, 12, 0, Math.PI * 2, 0, bat ? Math.PI * 0.6 : Math.PI / 2), helmetMat);
  cap.position.y = bat ? 1.7 : 1.69; cap.castShadow = true;
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.018, 0.11), helmetMat);
  brim.position.set(0, bat ? 1.7 : 1.69, 0.15);
  rig.add(cap, brim);
  if (bat) { const flap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.09), helmetMat); flap.position.set(0.12, 1.65, 0.01); rig.add(flap); }

  // Arms: jersey sleeve to the elbow, bare forearm, hand. Batter's hands meet at the back shoulder.
  const hands = bat ? V(-0.27, 1.43, -0.1) : null;
  for (const s of [-1, 1]) {
    const shoulder = V(s * 0.23, 1.47, 0);
    const elbow = bat ? V(s < 0 ? -0.4 : 0.12, 1.26, s < 0 ? -0.06 : 0.24) : V(s * 0.31, 1.17, 0.08);
    const hand = hands ? hands.clone().add(V(s * 0.03, 0, 0)) : V(s * 0.29, 0.92, 0.23);
    rig.add(limb(shoulder, elbow, 0.062, sleeveMat, 0.05), limb(elbow, hand, 0.05, skin, 0.04));
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), gloveMat);
    palm.position.copy(hand); rig.add(palm);
    if (!bat && !ump && s < 0) { const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), std("#6d4327", 0.7)); glove.position.copy(hand).add(V(-0.03, -0.02, 0.05)); glove.scale.set(1, 1.15, 0.6); glove.castShadow = true; rig.add(glove); }
  }
  if (hands) {
    const b = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.016, 0.86, 10), std("#c9a06a", 0.45));
    stick.position.y = 0.43; stick.castShadow = true;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 10), std("#2a1d12", 0.5));
    b.add(stick, knob);
    b.position.copy(hands).add(V(0, 0.03, 0));
    b.rotation.set(-0.58, 0, 0.41);
    b.name = "bat";
    rig.add(b);
    rig.rotation.y = Math.PI / 2; // local +z (chest) now faces +x, across the plate
  }
  mergeByMaterial(rig); // the bat group is not a Mesh, so it stays separate and keeps animating
  g.add(rig);
  g.userData = { bodyMat, sleeveMat, capMat, cleatMat, helmetMat, gloveMat, skin: SKIN[seed % SKIN.length], bat };
  g.scale.setScalar(PLAYER_SCALE);
  return g;
}

/** Put a rig in a team's uniform: jersey texture (with the player's name/number when known), sleeves, cap, socks. */
function dress(g: THREE.Group, team: SimTeam, player: SimPlayer | null) {
  const u = g.userData as {
    bodyMat: THREE.MeshStandardMaterial; sleeveMat: THREE.MeshStandardMaterial; capMat: THREE.MeshStandardMaterial;
    cleatMat: THREE.MeshStandardMaterial; helmetMat: THREE.MeshStandardMaterial; gloveMat: THREE.MeshStandardMaterial; skin: string; bat: boolean;
  };
  u.bodyMat.map = jerseyTexture(team, player);
  u.bodyMat.color.set("#ffffff"); // colour lives in the texture now
  u.bodyMat.needsUpdate = true;
  u.sleeveMat.color.set(team.color);
  u.capMat.color.set(team.color).multiplyScalar(0.8);
  // Bought colourways (only the user's team carries any); otherwise the stock look.
  const look = (slot: CosmeticSlot) => COSMETIC_BY_ID[team.gear?.cosmetics?.[slot] ?? ""]?.color;
  u.cleatMat.color.set(look("cleats") ?? "#1a1a1e");
  if (u.bat) {
    const helmet = look("helmet");
    if (helmet) u.helmetMat.color.set(helmet); else u.helmetMat.color.set(team.color).multiplyScalar(0.8);
    u.gloveMat.color.set(look("gloves") ?? u.skin);
  }
}

/** Pooled additive particles: dirt and chalk bursts at contact, plus a slow ambient drift. */
class Dust {
  readonly points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private vel: Float32Array; private life: Float32Array;
  private next = 0;
  constructor(private n: number, private ambient: boolean, size: number, tex: THREE.Texture, private rand: () => number) {
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (ambient) { this.pos.set([(rand() - 0.5) * 50, rand() * 9, -rand() * 45], i * 3); this.vel.set([0.5 + rand() * 0.6, 0.05, 0], i * 3); this.life[i] = 1; }
      else this.pos[i * 3 + 1] = -100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.points.frustumCulled = false;
  }
  burst(origin: THREE.Vector3, count: number, speed: number) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      const rand = this.rand;
      this.pos.set([origin.x + (rand() - 0.5) * 0.4, origin.y, origin.z + (rand() - 0.5) * 0.4], i * 3);
      const a = rand() * Math.PI * 2, s = speed * (0.3 + rand());
      this.vel.set([Math.cos(a) * s, rand() * speed * 0.8, Math.sin(a) * s - speed * 0.2], i * 3);
      this.life[i] = 0.6 + rand() * 0.4;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      if (this.ambient) {
        this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt;
        if (this.pos[j] > 26) this.pos[j] = -26;
        const f = 0.14 + 0.1 * Math.sin(performance.now() / 2500 + i);
        this.col[j] = 0.85 * f; this.col[j + 1] = 0.79 * f; this.col[j + 2] = 0.7 * f;
        continue;
      }
      if (this.life[i] <= 0) { this.col[j] = this.col[j + 1] = this.col[j + 2] = 0; continue; }
      this.vel[j + 1] -= 5 * dt;
      for (let a = 0; a < 3; a++) { this.pos[j + a] += this.vel[j + a] * dt; this.vel[j + a] *= 1 - 0.8 * dt; }
      if (this.pos[j + 1] < 0.02) { this.pos[j + 1] = 0.02; this.vel[j + 1] *= -0.2; }
      this.life[i] -= dt * 0.7;
      const f = Math.max(0, this.life[i]) * 0.9;
      this.col[j] = 0.85 * f; this.col[j + 1] = 0.79 * f; this.col[j + 2] = 0.7 * f;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

class Director {
  speed = 1;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 400);
  private look = HOME_LOOK.clone();
  private shots: Shot[] = [];
  private shotT = 0; // real seconds into the current shot
  private cut = false; // next camera update snaps instead of easing (a hard cut)
  private tweens: Tween[] = [];
  private ball: THREE.Mesh;
  private ballFlying = false;
  private view: CameraView = "plate";
  private budget = 1.2; // real seconds the current event may block (ARC 10.3, already divided by speed)
  private fielders: THREE.Group[] = [];
  private batter: THREE.Group | null = null;
  private batterId: number | null = null;
  private onDeck: THREE.Group;
  private onDeckId: number | null = null;
  private pitcherDressed: number | null = null;
  private runners = new Map<number, THREE.Group & { base?: number }>();
  private half: string | null = null;
  private colors: Record<Side, THREE.Color>;
  private teams: PlayedGame["teams"];
  private burstDust: Dust; private drift: Dust;
  private rim: THREE.DirectionalLight; private pop: THREE.PointLight;
  private shake = 0;
  private plan: ShotPlan | null = null;
  private slideSub: SlideSubject | null = null;
  private events: GameEvent[];
  private eventIndex = 0; private lastPitchIndex = -1;
  private rec = new TransformRecorder(); private recT = 0; private recAcc = 0;
  private shotEvent: GameEvent | null = null; // the event the planned action shot replays
  private lastPitch: Extract<GameEvent, { type: "pitch" }> | null = null;
  private ump!: THREE.Group;
  private staged: { kind: ShotKind; hidden: [THREE.Object3D, boolean][]; actors: THREE.Group[]; figs: Record<string, THREE.Group>; hit: THREE.Vector3; rel: THREE.Vector3 } | null = null;
  private rand: () => number; // cosmetic stream (cosmetic.ts), never the sim's
  private prof = QUALITY_PROFILE[getQuality()]; // graphics tier, read once per renderer
  private raf = 0; private last = performance.now();
  private frameMs: number[] = []; private frames = 0; private last0 = 0; // shot mode: render-stats window

  constructor(private canvas: HTMLCanvasElement, game: PlayedGame, private reduced: boolean) {
    this.colors = { away: new THREE.Color(game.teams.away.color), home: new THREE.Color(game.teams.home.color) };
    this.teams = game.teams;
    this.events = game.result.events;
    this.rand = cosmeticRng(SHOT_MODE ? SHOT_SEED : game.result.seed);
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, this.prof.pixelRatio));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = this.prof.shadowMap > 0;
    this.scene.background = new THREE.Color("#0B0D12");
    this.scene.fog = new THREE.FogExp2("#0B0D12", 0.0028);

    // Night game under the towers: a bright, slightly warm key from the first-base bank, a cooler fill from
    // the third-base bank, rim from behind-right (VISUAL_DESIGN 7.2).
    const key = new THREE.DirectionalLight("#fff1d6", 3.0);
    key.position.set(-40, 55, 30);
    key.castShadow = this.prof.shadowMap > 0;
    key.shadow.mapSize.set(this.prof.shadowMap || 1, this.prof.shadowMap || 1);
    Object.assign(key.shadow.camera, { left: -55, right: 55, top: 70, bottom: -70, near: 1, far: 220 });
    key.target.position.set(0, 0, -30);
    const fill = new THREE.DirectionalLight("#dfe6ff", 0.9);
    fill.position.set(45, 40, 20);
    this.rim = new THREE.DirectionalLight("#f2e3c6", 1.2);
    this.rim.position.set(35, 22, -70);
    this.pop = new THREE.PointLight("#f2e3c6", 0, 14);
    this.pop.position.set(0.4, 1.4, 0.8);
    this.scene.add(key, key.target, fill, this.rim, this.pop, new THREE.HemisphereLight("#5b6a90", "#2a2418", 0.7));

    this.buildPark();
    const white = new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.4, emissive: "#443322", emissiveIntensity: 0.4 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), white);
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.scene.add(this.ball);

    FIELD_POS.forEach((p, i) => {
      const f = makePlayer(this.colors.home, false, i * 7 + 3);
      f.position.copy(p);
      if (i === 1) { f.scale.y = PLAYER_SCALE * 0.62; f.rotation.y = Math.PI; } // catcher's crouch, facing the mound
      this.fielders.push(f); this.scene.add(f);
    });
    // Plate umpire in navy, set behind the catcher; on-deck hitter waiting in the circle on the first-base side.
    const ump = this.ump = makePlayer(new THREE.Color("#1b2236"), false, 2, true);
    ump.position.set(0.35, 0, 3.4); ump.scale.y = PLAYER_SCALE * 0.78; ump.rotation.y = Math.PI;
    this.scene.add(ump);
    this.onDeck = makePlayer(this.colors.away, true, 4);
    this.onDeck.position.set(5.4, 0, 4.2); this.onDeck.rotation.y = -0.6; this.onDeck.visible = false;
    this.scene.add(this.onDeck);
    const dust = softSprite("rgba(255,255,255,1)");
    this.burstDust = new Dust(Math.round(400 * this.prof.dust), false, 0.9, dust, this.rand);
    this.drift = new Dust(Math.round(90 * this.prof.dust), true, 0.55, dust, this.rand);
    this.scene.add(this.burstDust.points, this.drift.points);

    this.cam.position.copy(this.homePos());
    this.raf = requestAnimationFrame(this.frame);
  }

  private buildPark() {
    const mat = (color: string, rough = 0.95) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const flat = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, z: number, y: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); mesh.receiveShadow = true; this.scene.add(mesh); return mesh;
    };
    const arc = (geo: THREE.BufferGeometry, m: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(geo, m); mesh.position.y = y; (mesh.material as THREE.Material).side = THREE.DoubleSide; this.scene.add(mesh); return mesh;
    };
    const dirt = mat("#86613f"), clay = mat("#9a7250");
    flat(new THREE.CircleGeometry(WALL_R, 96, Math.PI / 2 - 1.25, 2.5), new THREE.MeshStandardMaterial({ map: grassTexture(14), roughness: 1 }), 0, 0, 0);
    flat(new THREE.RingGeometry(WALL_R - 5, WALL_R, 96, 1, Math.PI / 2 - 1.25, 2.5), dirt, 0, 0, 0.012); // warning track
    flat(new THREE.CircleGeometry(24, 64), dirt, 0, -18.4, 0.01);
    const inner = flat(new THREE.PlaneGeometry(27, 27), new THREE.MeshStandardMaterial({ map: grassTexture(2), roughness: 1 }), 0, -19.4, 0.02); inner.rotation.z = Math.PI / 4;
    flat(new THREE.CircleGeometry(7, 40), dirt, 0, 0.5, 0.03);
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 0.3, 32), clay); mound.position.set(0, 0.15, -18.4); mound.receiveShadow = true; this.scene.add(mound);
    const rubber = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.15), mat("#f0ece2", 0.6)); rubber.position.set(0, 0.31, -18.4); this.scene.add(rubber);
    const chalk = new THREE.MeshBasicMaterial({ color: "#e8e1d2" });
    for (const s of [-1, 1]) { // foul lines
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, WALL_R * 1.1), chalk);
      line.rotation.set(-Math.PI / 2, 0, s * Math.PI / 4); line.position.set(s * WALL_R * 0.389, 0.04, -WALL_R * 0.389); this.scene.add(line);
      for (const [w, d, dx, dz] of [[0.08, 1.9, 0.6, 0], [0.08, 1.9, -0.6, 0], [1.28, 0.08, 0, 0.95], [1.28, 0.08, 0, -0.95]]) { // batter's boxes
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(w, d), chalk);
        edge.rotation.x = -Math.PI / 2; edge.position.set(s * 0.95 + dx, 0.045, 0.3 + dz); this.scene.add(edge);
      }
    }
    BASES.forEach((b, i) => {
      const m = i === 0 ? new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 5), chalk)
        : new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.6), chalk);
      m.position.set(b.x, 0.07, b.z); if (i) m.rotation.y = Math.PI / 4; this.scene.add(m);
    });

    // Padded outfield wall with a yellow line, foul poles, fictional-maker signage.
    const wall = arc(new THREE.CylinderGeometry(WALL_R, WALL_R, 3.2, 96, 1, true, Math.PI - 1.25, 2.5), mat("#1c4a35", 0.9), 1.6);
    wall.receiveShadow = true;
    arc(new THREE.CylinderGeometry(WALL_R + 0.05, WALL_R + 0.05, 0.16, 96, 1, true, Math.PI - 1.25, 2.5), new THREE.MeshBasicMaterial({ color: "#f3c724" }), 3.2);
    const yellow = mat("#f3c724", 0.5);
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 16, 10), yellow);
      pole.position.set(s * WALL_R * Math.sin(1.25), 8, -WALL_R * Math.cos(1.25)); this.scene.add(pole);
    }
    const signs: [string, string, string][] = [["NORTHWIND", "#0e2a4a", "#f4f1ea"], ["RIDGEBACK", "#5a1a16", "#f2e3c6"], ["CASCADE", "#123d3a", "#e9f3ef"]];
    [-0.72, 0, 0.72].forEach((a, i) => {
      const [text, bg, fg] = signs[i];
      const panel = new THREE.Mesh(new THREE.BoxGeometry(16, 2.4, 0.2), new THREE.MeshStandardMaterial({ map: signTexture(text, bg, fg), roughness: 0.6 }));
      panel.position.set(Math.sin(a) * (WALL_R - 0.4), 1.6, -Math.cos(a) * (WALL_R - 0.4)); panel.rotation.y = -a; this.scene.add(panel);
    });

    // Two decks of seating with a crowd, a facade between, a scoreboard in centre, six light towers.
    const seats = mat("#2a3140", 0.95), concrete = mat("#1a1e28", 0.95);
    arc(new THREE.CylinderGeometry(WALL_R + 26, WALL_R + 4, 11, 96, 1, true, Math.PI - 1.4, 2.8), seats, 9);
    arc(new THREE.CylinderGeometry(WALL_R + 27, WALL_R + 27, 3.5, 96, 1, true, Math.PI - 1.4, 2.8), concrete, 16.2);
    arc(new THREE.CylinderGeometry(WALL_R + 46, WALL_R + 28, 13, 96, 1, true, Math.PI - 1.4, 2.8), seats, 24.5);
    this.crowd(WALL_R + 5, WALL_R + 25, 4, 14, Math.round(5200 * this.prof.crowd));
    this.crowd(WALL_R + 29, WALL_R + 45, 18.5, 31, Math.round(5200 * this.prof.crowd));
    const board = new THREE.Mesh(new THREE.BoxGeometry(30, 10, 1.4), concrete);
    board.position.set(0, 24, -(WALL_R + 12)); this.scene.add(board);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(28, 8.4), new THREE.MeshBasicMaterial({ map: signTexture("BASEBALL 2027", "#0a0d14", "#f2e3c6", 1024, 300) }));
    face.position.set(0, 24, -(WALL_R + 11.25)); this.scene.add(face);
    const glow = softSprite("rgba(255,241,214,1)");
    const bankMat = new THREE.MeshBasicMaterial({ color: "#fff6e3" });
    for (const a of [-1.3, -0.85, -0.35, 0.35, 0.85, 1.3]) {
      const r = WALL_R + 42, x = Math.sin(a) * r, z = -Math.cos(a) * r;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 56, 8), concrete);
      pole.position.set(x, 28, z); this.scene.add(pole);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(11, 4.5, 0.6), bankMat);
      bank.position.set(x, 54, z); bank.rotation.y = -a; bank.rotation.x = 0.5; this.scene.add(bank);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.position.set(x, 54, z); s.scale.setScalar(34); this.scene.add(s);
    }
    const flash = softSprite("rgba(230,240,255,1)");
    for (let i = 0; i < 40; i++) { // camera flashes in the decks
      const rand = this.rand;
      const a = (rand() - 0.5) * 2.6, r = WALL_R + 6 + rand() * 38;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flash, transparent: true, opacity: 0.15 + rand() * 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.position.set(Math.sin(a) * r, 5 + rand() * 26, -Math.cos(a) * r);
      s.scale.setScalar(2 + rand() * 4);
      this.scene.add(s);
    }
    mergeByMaterial(this.scene); // static park only: nothing else is in the scene yet
  }

  /** A deck full of people as coloured points along the seating slope. */
  private crowd(rIn: number, rOut: number, yIn: number, yOut: number, n: number) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), c = new THREE.Color(), rand = this.rand;
    for (let i = 0; i < n; i++) {
      const a = (rand() - 0.5) * 2.75, t = rand(), r = rIn + (rOut - rIn) * t;
      pos.set([Math.sin(a) * r, yIn + (yOut - yIn) * t + 0.5, -Math.cos(a) * r], i * 3);
      const p = rand();
      if (p < 0.35) c.copy(this.colors.home).offsetHSL(0, -0.1, (rand() - 0.5) * 0.2);
      else if (p < 0.5) c.set("#f4f1ea").multiplyScalar(0.6 + rand() * 0.4);
      else c.setHSL(rand(), 0.45, 0.25 + rand() * 0.35);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.75, vertexColors: true, sizeAttenuation: true })));
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }

  // --- animation plumbing ------------------------------------------------------------------

  private tween(dur: number, fn: (p: number) => void, delay = 0, end?: () => void) { this.tweens.push({ t: 0, delay, dur: Math.max(dur, 0.0001), fn, end }); }
  private after(delay: number, fn: () => void) { this.tween(0.0001, () => {}, delay, fn); }

  /** Finish everything still running, so a fast-forwarded event never leaves the field half-animated. */
  private flush() {
    let guard = 0;
    while (this.tweens.length && guard++ < 50) {
      const batch = this.tweens; this.tweens = [];
      for (const w of batch) { w.fn(1); w.end?.(); }
    }
    this.ballFlying = false;
    this.unstage();
    if (this.shots.length) this.cutTo([]); // hard cut back only if a sequence was running; routine events ease
  }

  /** Replace the shot list; the first shot (or the gameplay camera) starts with a hard cut. */
  private cutTo(shots: Shot[]) {
    const a = this.actionShot();
    // One owner per highlight: an eligible event gets the broadcast view for the result, then its action shot in the tail
    // of the hold. The older barrel/dust/ride/hero sequence only runs when there is no action shot.
    this.shots = a ? [{ kind: "broadcast", dur: Math.max(0.12, this.budget - a.dur), scale: 1 }, a] : fitShots(shots, this.budget);
    this.shotT = 0; this.cut = true;
  }

  /** The planned action shot as a camera segment, or null (the broadcast camera stays) if its subject is not on the field. */
  private actionShot(): Shot | null {
    const p = this.plan;
    if (!p) return null;
    if (p.camera === "release" && !this.fielders[0]) return null;
    if (p.camera === "slide" && !this.slideSub) return null;
    const e = this.shotEvent;
    const bats = e?.type === "play" ? this.player(this.battingSide(e), e.batterId)?.bats : undefined;
    return { kind: p.camera, dur: p.durMs / 1000 / this.speed, scale: 1, still: p.still, base: p.camera === "slide" ? this.slideSub!.base : 1, side: p.camera === "release" ? (SHOT_THROWS === "L" ? 1 : -1) : bats === "L" ? -1 : 1 };
  }

  private flight(from: THREE.Vector3, to: THREE.Vector3, peak: number, dur: number, delay = 0, hold = false) {
    this.tween(dur, (p) => {
      if (p > 0 && !hold) this.ball.visible = true;
      this.ball.position.lerpVectors(from, to, p);
      this.ball.position.y += 4 * peak * p * (1 - p);
    }, delay, undefined);
    this.after(delay, () => { this.ball.visible = true; this.ballFlying = true; });
    this.after(delay + dur, () => { this.ballFlying = false; });
  }

  private grounder(from: THREE.Vector3, to: THREE.Vector3, dur: number, delay = 0) {
    this.after(delay, () => { this.ball.visible = true; this.ballFlying = true; });
    this.tween(dur, (p) => {
      this.ball.position.lerpVectors(from, to, p);
      this.ball.position.y = 0.15 + 0.7 * Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p);
    }, delay);
    this.after(delay + dur, () => { this.ballFlying = false; });
  }

  private moveTo(g: THREE.Object3D, to: THREE.Vector3, dur: number, delay = 0) {
    const from = g.position.clone();
    this.tween(dur, (p) => g.position.lerpVectors(from, to, p), delay);
  }

  private fadeOut(g: THREE.Object3D, delay: number, then?: () => void) {
    const s = g.scale.x;
    this.tween(0.4, (p) => g.scale.setScalar(s * (1 - p)), delay, () => { this.scene.remove(g); then?.(); });
  }

  // --- event handling ----------------------------------------------------------------------

  handle(e: GameEvent, jumped: boolean, plan: ShotPlan | null = null, index = 0) {
    this.flush();
    this.eventIndex = index;
    this.view = cameraViewFor(e);
    this.plan = plan;
    this.shotEvent = e;
    if (e.type === "pitch") { this.lastPitch = e; this.lastPitchIndex = index; }
    this.budget = holdWithShot(blockingBudgetMs(e), plan) / 1000 / this.speed;
    this.syncHalf(e);
    this.syncPitcher(e);
    if (jumped) this.resync(e);
    this.fielders.forEach((f, i) => f.position.copy(FIELD_POS[i]));
    this.ball.visible = false;
    if (e.type === "pitch") this.onPitch(e);
    else if (e.type === "play") this.onPlay(e);
    else if (e.type === "half_start") this.clearRunners();
    else if (e.type === "run") this.resync(e);
    this.slideSub = slideSubject(this.events, index);
    this.sample();
    if (plan && !this.shots.some((x) => x.kind === plan.camera)) this.cutTo([]); // routine plays that still earn a shot
  }

  private syncHalf(e: GameEvent) {
    const key = `${e.state.inning}${e.state.half}`;
    if (key === this.half) return;
    this.half = key;
    const bat: Side = e.state.half === "top" ? "away" : "home";
    const def: Side = bat === "away" ? "home" : "away";
    const team = this.teams[def];
    this.fielders.forEach((f, i) => { if (i > 0) dress(f, team, team.lineup.find((p) => p.position === SLOT_POS[i]) ?? null); });
    this.pitcherDressed = null;
    this.runners.forEach((r, id) => dress(r, this.teams[bat], this.player(bat, id)));
    if (this.batter) { this.scene.remove(this.batter); this.batter = null; this.batterId = null; }
    this.onDeck.visible = false; this.onDeckId = null;
  }

  private battingSide(e: GameEvent): Side { return e.state.half === "top" ? "away" : "home"; }
  private battingColor(e: GameEvent) { return this.colors[this.battingSide(e)]; }
  private player(side: Side, id: number): SimPlayer | null {
    const t = this.teams[side];
    return t.lineup.find((p) => p.id === id) ?? t.pitchers.find((p) => p.id === id) ?? null;
  }

  /** Keep the mound rig in the current pitcher's name and number (starter, then relievers). */
  private syncPitcher(e: GameEvent) {
    const id = "pitcherId" in e ? e.pitcherId : null;
    if (id === null || id === this.pitcherDressed) return;
    const def: Side = this.battingSide(e) === "away" ? "home" : "away";
    dress(this.fielders[0], this.teams[def], this.player(def, id));
    this.pitcherDressed = id;
  }

  private ensureBatter(e: GameEvent, id: number) {
    const side = this.battingSide(e), team = this.teams[side];
    if (this.batterId !== id || !this.batter) {
      if (this.batter) this.scene.remove(this.batter);
      this.batter = makePlayer(this.battingColor(e), true, id);
      dress(this.batter, team, this.player(side, id));
      this.batter.position.set(-0.95, 0, 0.3);
      this.batterId = id;
      this.scene.add(this.batter);
    } else { this.batter.rotation.y = 0; this.batter.scale.setScalar(PLAYER_SCALE); }
    const i = team.lineup.findIndex((p) => p.id === id);
    const next = i >= 0 ? team.lineup[(i + 1) % team.lineup.length] : null;
    if (next && next.id !== this.onDeckId) { dress(this.onDeck, team, next); this.onDeckId = next.id; }
    this.onDeck.visible = !!next;
  }

  private clearRunners() { this.runners.forEach((r) => this.scene.remove(r)); this.runners.clear(); }

  private resync(e: GameEvent) {
    this.clearRunners();
    const { first, second, third } = e.state.bases;
    [first, second, third].forEach((id, i) => {
      if (id === null) return;
      const r = makePlayer(this.battingColor(e), false, id) as THREE.Group & { base?: number };
      dress(r, this.teams[this.battingSide(e)], this.player(this.battingSide(e), id));
      r.base = i + 1; r.position.copy(BASES[i + 1]); this.scene.add(r); this.runners.set(id, r);
    });
    if (this.batter) { this.scene.remove(this.batter); this.batter = null; this.batterId = null; }
  }

  private swing(delay: number, miss: boolean) {
    const b = this.batter;
    if (!b) return;
    const bat = b.getObjectByName("bat");
    // Right-handed cut: hips open toward the pitcher, barrel drops from the back shoulder and extends flat.
    this.tween(0.2, (p) => { b.rotation.y = 2.4 * p; if (bat) { bat.rotation.z = 0.41 - 1.5 * p; bat.rotation.x = -0.58 + 1.0 * p; } }, delay);
    if (miss) this.after(delay + 0.25, () => {});
  }

  private onPitch(e: Extract<GameEvent, { type: "pitch" }>) {
    this.ensureBatter(e, e.batterId);
    const bat = this.batter?.getObjectByName("bat");
    if (bat) bat.rotation.set(-0.58, 0, 0.41);
    const dur = Math.min(0.5, Math.max(0.3, 0.55 - (e.mph - 70) * 0.006));
    const i = e.state.score.away * 7 + e.state.score.home * 3 + e.state.balls * 11 + e.state.strikes * 13 + e.state.outs * 17 + e.mph;
    const side = rnd(i, 3) < 0.5 ? -1 : 1;
    let tx = e.zone ? (rnd(i, 1) - 0.5) * 0.4 : side * (0.3 + rnd(i, 2) * 0.35);
    let ty = e.zone ? 0.5 + rnd(i, 4) * 0.6 : rnd(i, 5) < 0.5 ? 0.2 : 1.3;
    if (e.shot) { [tx, ty] = pitchSpot(e.shot); } // recorded location when the event carries it
    const from = V(0.1, 1.95, -16.8), to = V(tx, ty, 0);
    const pitcher = this.fielders[0];
    this.tween(0.35, (p) => { pitcher.rotation.x = 0.35 * Math.sin(p * Math.PI); });
    this.ball.visible = true;
    this.tween(dur, (p) => { this.ball.position.lerpVectors(from, to, p); this.ball.position.y -= 0.35 * p * p; }, 0.1, () => {
      if (e.result === "ball" || e.result === "called_strike") this.after(0.05, () => { this.ball.position.set(tx, ty, 1.2); });
      if (e.result === "swinging_strike") this.ball.position.set(tx, ty, 1.2);
    });
    if (e.result === "ball" || e.result === "called_strike") this.after(0.1 + dur + 0.3, () => { this.ball.visible = false; });
    if (e.result === "swinging_strike") { this.swing(0.1 + dur - 0.12, true); this.after(0.1 + dur + 0.3, () => { this.ball.visible = false; }); }
    if (e.result === "foul") {
      this.swing(0.1 + dur - 0.12, false);
      const a = (rnd(i, 6) < 0.5 ? -1 : 1) * (0.9 + rnd(i, 7) * 0.5);
      this.after(0.1 + dur, () => this.burstDust.burst(V(0, 0.5, 0), 25, 3));
      this.flight(V(tx, ty, 0), polar(18 + rnd(i, 8) * 30, a), 7, 1.0, 0.1 + dur);
      this.after(0.1 + dur + 1.0, () => { this.ball.visible = false; });
    }
    if (e.result === "in_play") { this.swing(0.1 + dur - 0.12, false); this.after(0.1 + dur, () => { this.ball.visible = false; }); }
  }

  private nearestOF(angle: number) { return this.fielders[angle < -0.3 ? 6 : angle > 0.3 ? 8 : 7]; }

  private onPlay(e: Play) {
    this.ensureBatter(e, e.batterId);
    const idx = e.state.score.away * 5 + e.state.score.home * 7 + e.state.outs * 3 + e.batterId + e.pitcherId;
    const o = e.outcome;
    const big = e.tier === 1 || e.tier === 2;
    const cinematic = !this.reduced && big;
    const contact = V(0, 1, 0);
    const batter = this.batter;
    const delay = 0.35;

    if (o === "strikeout" || o === "walk") {
      this.syncRunners(e, 0.1);
      // A signature or highlight punch-out: pitcher's stare, then the batter walking off.
      if (o === "strikeout" && big) this.cutTo(this.reduced ? [on("drive", batter, 1.0)] : [on("drive", this.fielders[0], 0.9), on("hero", batter, e.tier === 1 ? 1.6 : 1.0)]);
      return;
    }
    if (cinematic) { this.shake = o === "home_run" || o === "triple" ? 0.35 : 0.15; this.pop.intensity = 14; }
    this.burstDust.burst(V(0, 0.15, 0.2), cinematic ? 220 : 40, cinematic ? 7 : 3.5);
    this.swing(0, false);
    const ang = e.shot ? sprayAngle(e.shot.spray) : (rnd(idx, 1) - 0.5) * 1.35;
    const side = ang < 0 ? -1 : 1;
    let outcomeFielder: THREE.Group | null = null;
    const trot = o === "home_run" && cinematic ? 1.1 : 0.5; // seconds per base; a homer is admired, not sprinted

    if (o === "home_run") {
      const feet = parseInt(e.stat ?? "400", 10) || 400;
      const to = polar(Math.max(feet * FT, WALL_R + 6), ang * 0.8); to.y = 9;
      this.flight(contact, to, 38 + rnd(idx, 2) * 14, 2.7);
      this.after(2.7, () => { this.burstDust.burst(V(to.x, 6, to.z), 30, 4); this.ball.visible = false; });
      this.tween(1.6, (p) => this.nearestOF(ang).position.lerpVectors(FIELD_POS[7], polar(WALL_R - 6, ang * 0.8), p * 0.6), 0.4);
    } else if (o === "single") {
      const to = polar(42 + rnd(idx, 2) * 16, ang);
      this.flight(contact, to, 6, 0.9);
      outcomeFielder = this.nearestOF(ang); this.moveTo(outcomeFielder, to, 1.1, 0.2);
    } else if (o === "double") {
      const to = polar(72 + rnd(idx, 2) * 14, side * (0.35 + rnd(idx, 3) * 0.3));
      this.flight(contact, to, 12, 1.4);
      outcomeFielder = this.nearestOF(side * 0.5); this.moveTo(outcomeFielder, to, 1.7, 0.2);
    } else if (o === "triple") {
      const to = polar(WALL_R - 8, side * (0.55 + rnd(idx, 3) * 0.2));
      this.flight(contact, to, 14, 1.7);
      outcomeFielder = this.nearestOF(side * 0.6); this.moveTo(outcomeFielder, to, 1.9, 0.2);
    } else if (o === "flyout" || o === "sac_fly") {
      const to = polar(50 + rnd(idx, 2) * 28, ang);
      this.flight(contact, to, 20, 1.9);
      outcomeFielder = this.nearestOF(ang); this.moveTo(outcomeFielder, to, 1.7, 0.1);
      this.after(1.9, () => { this.ball.visible = false; });
    } else if (o === "lineout") {
      const f = this.fielders[2 + Math.floor(rnd(idx, 2) * 4)];
      this.flight(contact, f.position.clone().setY(1.4), 1.5, 0.5);
      this.after(0.5, () => { this.ball.visible = false; });
    } else { // groundout, double_play
      const dp = o === "double_play";
      const f = this.fielders[dp ? 3 + Math.floor(rnd(idx, 2) * 2) : 2 + Math.floor(rnd(idx, 2) * 4)];
      const fp = f.position.clone();
      this.grounder(contact, fp.clone().setY(0.15), 0.8);
      if (dp) {
        this.flight(fp.clone().setY(1.3), BASES[2].clone().setY(1.2), 1.5, 0.4, 0.85);
        this.flight(BASES[2].clone().setY(1.3), BASES[1].clone().setY(1.2), 1.5, 0.45, 1.35);
        this.after(1.8, () => { this.ball.visible = false; });
      } else if (f !== this.fielders[2]) {
        this.flight(fp.clone().setY(1.3), BASES[1].clone().setY(1.2), 1.5, 0.5, 0.85);
        this.after(1.35, () => { this.ball.visible = false; });
      } else this.after(0.85, () => { this.ball.visible = false; });
      outcomeFielder = f;
    }
    this.syncRunners(e, delay, trot);

    if (this.reduced) { if (big) this.cutTo([on("drive", batter, 1.2)]); return; }
    if (e.tier === 3) { this.cutTo([on("drive", batter, 0.8)]); return; }
    if (!big) return;
    // VISUAL_DESIGN 3.2: barrel freeze → slow release with a quarter orbit → ride the ball → reaction → hero.
    this.ball.position.copy(contact); this.ball.visible = true;
    const isOut = o === "flyout" || o === "lineout" || o === "groundout" || o === "double_play" || o === "sac_fly";
    const closer: Shot[] = o === "double_play" ? [on("dive", this.at(BASES[2]), 0.9), on("drive", this.fielders[3], 0.6)]
      : isOut && outcomeFielder ? [on("dive", outcomeFielder, 1.0)]
      : e.tier === 1 ? [on("hero", batter, 1.4), on("drive", batter, 0.8)]
      : [on("hero", batter, 0.9)];
    this.cutTo([barrel(), dust(e.tier === 1 ? 0.9 : 0.55), ride(o === "home_run" ? 3.4 : 2.4), ...closer]);
  }

  // --- action-shot staging ---------------------------------------------------------------
  // By the time an action shot runs, the live scene has moved on (the batter is a runner, the ball is far away). Each shot
  // places jointed figures (shotfigure.ts) from the transforms the recorder captured while the event was live, falling back
  // to the event's facts, poses them every frame from the shot clock (shotscene.ts), and hides the live figures that would
  // stand in the frame. Presentation only; nothing here touches the sim.

  /** Sample the live athletes and ball into the ring buffer (presentation-only; reads transforms, writes nothing back). */
  private sample() {
    const actors: Record<string, Placement> = {};
    const d = new THREE.Vector3();
    const put = (k: string, o: THREE.Object3D | null) => {
      if (!o || !o.visible) return;
      (o.getObjectByName("rig") ?? o).getWorldDirection(d);
      actors[k] = { x: o.position.x, y: o.position.y, z: o.position.z, ry: Math.atan2(d.x, d.z) };
    };
    put("batter", this.batter);
    this.runners.forEach((r, id) => put(`r${id}`, r));
    this.fielders.forEach((f, i) => put(`f${i}`, f));
    const b = this.ball.position;
    this.rec.record({ event: this.eventIndex, t: this.recT, actors, ball: this.ball.visible ? [b.x, b.y, b.z] : null });
  }

  private figure(side: Side, id: number | null, bat: boolean, position: string | null = null, glove: 0 | 1 | null = 0): THREE.Group {
    const team = this.teams[side];
    const player = id === null ? (position ? team.lineup.find((p) => p.position === position) ?? null : null) : this.player(side, id);
    const g = makeShotFigure(this.colors[side], SKIN[(player?.id ?? id ?? 0) % SKIN.length], bat, false, glove);
    dress(g, team, player);
    return g;
  }

  private stageIn(kind: ShotKind) {
    const e = this.shotEvent;
    if (!e) return;
    const hidden: [THREE.Object3D, boolean][] = [];
    const hide = (o: THREE.Object3D | null | undefined) => { if (o) { hidden.push([o, o.visible]); o.visible = false; } };
    hide(this.batter); this.runners.forEach((r) => hide(r)); hide(this.onDeck); hide(this.fielders[1]); hide(this.ump);
    const st: NonNullable<Director["staged"]> = this.staged = { kind, hidden, actors: [], figs: {}, hit: V(0, 1, 0), rel: V(0, 2, -17) };
    const bat: Side = this.battingSide(e), def: Side = bat === "away" ? "home" : "away";
    const add = (key: string, g: THREE.Group) => { this.scene.add(g); st.actors.push(g); st.figs[key] = g; return g; };
    if (kind === "contact" && e.type === "play") {
      const sc = contactScene(this.rec, this.eventIndex, this.player(bat, e.batterId)?.bats, e.shot);
      const g = add("batter", this.figure(bat, e.batterId, true));
      g.position.set(sc.batter.x, 0, sc.batter.z); g.rotation.y = sc.batter.ry;
      st.hit.copy(this.hitPoint(g, sc.side));
    } else if (kind === "release") {
      const pid = this.lastPitch && "pitcherId" in this.lastPitch ? this.lastPitch.pitcherId : null;
      hide(this.fielders[0]);
      add("pitcher", this.figure(def, pid, false, "P", throwIndex(SHOT_THROWS) === 0 ? 1 : 0));
    } else if (kind === "slide" && this.slideSub) {
      const sub = this.slideSub;
      const sc = slideScene(this.rec, this.eventIndex, sub);
      hide(this.fielders[sc.slot]);
      const wrap = new THREE.Group();
      const body = this.figure(bat, sub.runnerId, false, null, null);
      wrap.add(body); this.scene.add(wrap); st.actors.push(wrap); st.figs.runner = body; st.figs.runnerWrap = wrap;
      add("fielder", this.figure(def, null, false, SLOT_POS[sc.slot]));
    }
    this.ball.visible = true;
    this.drift.points.visible = false; this.burstDust.points.visible = false;
  }

  private unstage() {
    const st = this.staged;
    if (!st) return;
    this.staged = null;
    st.actors.forEach((a) => {
      this.scene.remove(a);
      a.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        mats.forEach((x) => x.dispose());
      });
    });
    st.hidden.forEach(([o, v]) => { o.visible = v; });
    this.ball.visible = false;
    this.drift.points.visible = true; this.burstDust.points.visible = true;
  }

  private syncStage() {
    const s = this.shots[0];
    const kind = s && (s.kind === "contact" || s.kind === "release" || s.kind === "slide") ? s.kind : null;
    if (this.staged && this.staged.kind !== kind) this.unstage();
    if (!kind || !s) return;
    if (!this.staged) this.stageIn(kind);
    if (!this.staged) return;
    const q = s.still ? 0.5 : clamp01(this.shotT / s.dur);
    if (kind === "contact") this.poseContact(q);
    else if (kind === "release") this.poseRelease(q);
    else this.poseSlide(q);
  }

  private hitPoint(g: THREE.Group, side: 1 | -1) {
    applyPose(g, side === 1 ? contactPose(CONTACT_Q) : mirrorPose(contactPose(CONTACT_Q)));
    g.updateMatrixWorld(true);
    const bat = g.userData.parts.bat as THREE.Object3D | null;
    return bat ? bat.localToWorld(V(0, 0.7, 0)) : V(0, 1, 0);
  }

  private get contactSide(): 1 | -1 {
    const e = this.shotEvent;
    return e?.type === "play" ? batSide(this.player(this.battingSide(e), e.batterId)?.bats) : 1;
  }

  private poseContact(q: number) {
    const e = this.shotEvent, st = this.staged, g = st?.figs.batter;
    if (!e || e.type !== "play" || !st || !g) return;
    const side = this.contactSide;
    applyPose(g, side === 1 ? contactPose(q) : mirrorPose(contactPose(q)));
    const sc = contactScene(this.rec, this.eventIndex, this.player(this.battingSide(e), e.batterId)?.bats, e.shot);
    const t = q - CONTACT_Q;
    if (t < 0) { this.ball.position.set(st.hit.x, st.hit.y + 0.4 * -t, st.hit.z + 6 * t); return; } // arriving from the pitcher
    const [bx, by, bz] = contactBall(q, [st.hit.x, st.hit.y, st.hit.z], sc.dir);
    this.ball.position.set(bx, by, bz);
  }

  private poseRelease(q: number) {
    const st = this.staged, g = st?.figs.pitcher;
    if (!st || !g) return;
    const sc = releaseScene(this.rec, this.lastPitchIndex, this.lastPitch?.shot);
    const ry = Math.abs(sc.pitcher.ry) < 0.8 ? sc.pitcher.ry : 0;
    const ti = throwIndex(SHOT_THROWS);
    const stride = (k: number) => 0.6 * clamp01(k / 0.35) ** 2;
    g.position.set(sc.pitcher.x, 0, sc.pitcher.z + stride(q)); g.rotation.y = ry;
    applyPose(g, releasePose(q, SHOT_THROWS));
    if (q < RELEASE_Q) { handWorld(g, ti, this.ball.position); return; } // held until the release frame
    // The release point is the hand at RELEASE_Q; the ball then flies to the plate crossing.
    const f = clamp01((q - RELEASE_Q) / (1 - RELEASE_Q));
    const [tx, ty, tz] = sc.target;
    const sh = this.lastPitch?.shot;
    g.position.z = sc.pitcher.z + stride(RELEASE_Q);
    applyPose(g, releasePose(RELEASE_Q, SHOT_THROWS)); handWorld(g, ti, st.rel);
    g.position.z = sc.pitcher.z + stride(q); applyPose(g, releasePose(q, SHOT_THROWS));
    const e = f * f * 0.9 + f * 0.1;
    this.ball.position.set(st.rel.x + (tx - st.rel.x) * e, st.rel.y + (ty - st.rel.y) * e - 0.5 * f * (1 - f) * (sh && sh.type === "curve" ? 1.6 : 1), st.rel.z + (tz - st.rel.z) * e);
  }

  private tagTarget = new THREE.Vector3();
  private poseSlide(q: number) {
    const st = this.staged, sub = this.slideSub;
    if (!st || !sub || !st.figs.runner) return;
    const sc = slideScene(this.rec, this.eventIndex, sub), a = sc.axes;
    const wrap = st.figs.runnerWrap, body = st.figs.runner, fld = st.figs.fielder;
    wrap.rotation.y = Math.atan2(a.dx, a.dz);
    body.rotation.set(-SLIDER_TILT, 0, 0);
    applyPose(body, sliderPose(q));
    (body.userData.parts as { pelvis: THREE.Object3D }).pelvis.position.y = 0; // pelvis is the tilt pivot
    body.position.set(0, SLIDER_HIP, 0);
    const run = 1.7 - 1.35 * q; // feet this far short of the bag: still sliding in, arriving as the shot ends
    wrap.position.set(a.bx - a.dx * run, 0, a.bz - a.dz * run);
    const fx = sc.fielder ? sc.fielder.x : a.bx - a.nx * FIELDER_BACK, fz = sc.fielder ? sc.fielder.z : a.bz - a.nz * FIELDER_BACK;
    fld.position.set(fx, 0, fz);
    fld.rotation.y = Math.atan2(a.nx - a.dx, a.nz - a.dz);
    applyPose(fld, fielderPose(q));
    // The glove reaches for the tag point on the runner's lead foot, as far as the arm goes; the ball is in the glove.
    const tag = tagPoint(a, run);
    reachTo(fld, 0, this.tagTarget.set(tag[0], tag[1], tag[2]));
    handWorld(fld, 0, this.ball.position);
  }

  private at(p: THREE.Vector3) { const o = new THREE.Object3D(); o.position.copy(p); return o; }

  /** Move runners (and the batter) to where the sim says they are; scorers go home, outs fade. */
  private syncRunners(e: GameEvent, delay: number, trot = 0.5) {
    if (e.type !== "play") return;
    const target = new Map<number, number>();
    ([e.state.bases.first, e.state.bases.second, e.state.bases.third] as (number | null)[]).forEach((id, i) => { if (id !== null) target.set(id, i + 1); });
    const batterBase = target.get(e.batterId);
    const batterScored = e.outcome === "home_run";
    const leaving = [...this.runners.entries()].filter(([id]) => !target.has(id)).sort((a, b) => (b[1].base ?? 0) - (a[1].base ?? 0));
    let scorers = e.runs - (batterScored ? 1 : 0);

    for (const [id, r] of leaving) {
      this.runners.delete(id);
      if (scorers-- > 0) this.runPath(r, r.base ?? 1, 4, delay, true);
      else this.fadeOut(r, delay + 0.3);
    }
    for (const [id, r] of this.runners) {
      const b = target.get(id);
      if (b !== undefined && b !== r.base) { this.runPath(r, r.base ?? 1, b, delay, false); r.base = b; }
    }
    const b = this.batter;
    if (!b) return;
    if (batterBase !== undefined || batterScored) {
      this.batter = null; this.batterId = null;
      const runner = b as THREE.Group & { base?: number };
      runner.rotation.y = 0;
      const rig = b.getObjectByName("rig"); if (rig) rig.rotation.y = -Math.PI / 4; // face up the line
      const bat = b.getObjectByName("bat"); if (bat) b.remove(bat);
      this.moveTo(runner, BASES[0], 0.01);
      if (batterScored) this.runPath(runner, 0, 4, delay, true, trot);
      else { runner.base = batterBase; this.runners.set(e.batterId, runner); this.runPath(runner, 0, batterBase!, delay, false); }
    } else {
      this.batter = null; this.batterId = null;
      this.fadeOut(b, delay + 0.5);
    }
  }

  private runPath(g: THREE.Object3D, from: number, to: number, delay: number, remove: boolean, pace = 0.5) {
    for (let b = from; b < to; b++) {
      const a = BASES[b % 4], c = BASES[(b + 1) % 4], k = b - from;
      this.tween(pace, (p) => g.position.lerpVectors(a, c, p), delay + k * pace);
    }
    if (remove) this.after(delay + (to - from) * pace + 0.05, () => this.fadeOut(g, 0));
  }

  // --- render loop -------------------------------------------------------------------------

  private homePos() { return V(0, 4.6, 12.5); }

  /** ARC 10.1 gameplay views: behind the catcher for pitches, a high broadcast view once the ball is hit. */
  private viewPose(): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    switch (this.view) {
      case "field": return { pos: V(0, 15, 17), look: V(0, 0.5, -34), fov: 55 };
      case "runners": return { pos: V(0, 19, 20), look: V(0, 0, -16), fov: 55 };
      case "stadium": return { pos: V(0, 30, 34), look: V(0, 0, -40), fov: 58 };
      default: return { pos: this.homePos(), look: HOME_LOOK.clone(), fov: 48 };
    }
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (now - this.last < this.prof.minFrameMs) return; // battery tier: about 30 fps, animation stays wall-clock
    const real = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let scale = this.speed;
    const shot = this.shots[0];
    if (shot) {
      const held = SHOT_HOLD !== null && (shot.kind === "contact" || shot.kind === "release" || shot.kind === "slide");
      this.shotT = held ? SHOT_HOLD! * shot.dur : this.shotT + real;
      const s = shot.scale ?? 1;
      scale *= typeof s === "function" ? s(this.shotT) : s;
      const landed = shot.kind === "ride" && this.shotT > 0.3 && !this.ballFlying;
      if (!held && (this.shotT >= shot.dur || landed)) { this.shots.shift(); this.shotT = 0; this.cut = true; }
    }
    const dt = real * scale;
    this.tweens = this.tweens.filter((w) => {
      w.t += dt;
      if (w.t < w.delay) return true;
      const p = clamp01((w.t - w.delay) / w.dur);
      w.fn(p);
      if (p >= 1) { w.end?.(); return false; }
      return true;
    });
    this.burstDust.update(dt);
    this.drift.update(real);
    this.pop.intensity *= Math.exp(-real * 9);
    const kind = this.shots[0]?.kind;
    this.rim.intensity = 1.2 + (kind === "barrel" || kind === "dust" ? 1.6 : 0);
    // Oversized for the long gameplay lens only; every action shot keeps one size, whatever its camera.
    this.ball.scale.setScalar(BALL_SCALE); // one world size for every camera (shotscene.ts)
    this.recAcc += real; this.recT += real;
    if (!this.staged && this.recAcc >= 1 / 30) { this.recAcc = 0; this.sample(); }
    this.syncStage();
    this.updateCamera(real);
    this.renderer.render(this.scene, this.cam);
    if (SHOT_MODE) { this.publishStrikeZone(); this.publishStats(now); }
  };

  /** Shot mode only: `window.__renderStats`, the renderer's own counts plus frame-interval median/p95 over the last 60 frames. */
  private publishStats(now: number) {
    const f = this.frameMs;
    if (this.frames++) f.push(now - this.last0); // interval between two rendered frames
    if (f.length > 60) f.shift();
    this.last0 = now;
    const s = [...f].sort((a, b) => a - b), i = this.renderer.info;
    (window as unknown as { __renderStats: unknown }).__renderStats = {
      seq: this.frames, samples: s.length, calls: i.render.calls, triangles: i.render.triangles, points: i.render.points,
      geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0,
      frameMedianMs: s[s.length >> 1] ?? 0, frameP95Ms: s[Math.floor(s.length * 0.95)] ?? 0,
      shotKind: this.shots[0]?.kind ?? null, shotP: this.shots[0] ? this.shotT / this.shots[0].dur : 0,
    };
  }

  /** Shot mode only: where the plate and batter land on screen, so layout checks can assert nothing covers them. */
  private publishStrikeZone() {
    const c = this.renderer.domElement, r = c.getBoundingClientRect();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of [V(0.45, 0, -0.45), V(-0.45, 0, 0.45), V(-0.95, 1.9, 0.3), V(0.45, 1.9, -0.45), V(-1.4, 0, 0.3)]) {
      p.project(this.cam);
      const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    c.dataset.plate = [x0, y0, x1 - x0, y1 - y0].map(Math.round).join(",");
  }

  /** The named cameras (VISUAL_DESIGN 3.3): low, close and long-lensed; the gameplay camera when no shot runs. */
  private updateCamera(dt: number) {
    const vp = this.viewPose();
    let pos = vp.pos, look = vp.look, fov = vp.fov, rate = blendRate(this.reduced), hand = 0;
    const b = this.ball.position;
    const shot = this.shots[0];
    const t = shot?.target?.position ?? V(-0.95, 0, 0.3);
    switch (shot?.kind) {
      case "barrel": pos = V(-1.5, 0.75, 2.3); look = V(0.25, 1.05, 0); fov = 18; rate = 40; break;
      case "dust": { // behind the batter, swinging a quarter turn around him as the swing releases
        const a = -0.95 + 1.55 * clamp01(this.shotT / shot.dur);
        pos = V(-0.95 + Math.sin(a) * 3.1, 1.15, 0.3 + Math.cos(a) * 3.1); look = V(-0.7, 1.2, 0.1); fov = 26; rate = 40; break;
      }
      case "ride": pos = V(b.x * 0.6, b.y * 0.6 + 2.2, b.z + 9); look = b.clone(); fov = 34; rate = 5; break;
      case "drive": pos = t.clone().add(V(2.6, 1.4, 3.4)); look = t.clone().add(V(0, 1.1, 0)); fov = 30; rate = 8; hand = 0.012; break;
      case "hero": pos = t.clone().add(V(1.5, 0.45, 1.9)); look = t.clone().add(V(0, 1.55, 0)); fov = 22; rate = 10; hand = 0.02; break;
      case "dive": pos = t.clone().add(V(3.4, 0.3, 2.4)); look = t.clone().add(V(0, 0.7, 0)); fov = 26; rate = 10; hand = 0.015; break;
      case "contact": case "release": case "slide": {
        const q = shotPose(shot.kind, this.shotT / shot.dur, !!shot.still, shot.base, shot.side);
        pos = V(...q.pos); look = V(...q.look); fov = fitFov(q.fov, this.cam.aspect); rate = 40; hand = shot.still ? 0 : 0.008; break;
      }
      default:
        if (this.ballFlying && this.ball.visible) { look = vp.look.clone().lerp(b, 0.55); rate = Math.min(rate, 3); }
    }
    if (this.reduced) hand = 0;
    const k = this.cut || !isFinite(rate) ? 1 : 1 - Math.exp(-dt * rate);
    this.cut = false;
    this.cam.position.lerp(pos, k);
    this.look.lerp(look, k);
    this.cam.fov += (fov - this.cam.fov) * k;
    this.cam.updateProjectionMatrix();
    const jitter = this.shake > 0.001 ? this.shake : hand;
    if (jitter) {
      this.cam.position.x += (this.rand() - 0.5) * jitter; this.cam.position.y += (this.rand() - 0.5) * jitter;
      this.shake *= Math.exp(-dt * 6);
    }
    this.cam.lookAt(this.look);
  }
}

/** The ballpark. `index` is the current event; a jump of more than one event (skip, replay) re-syncs runners. */
export function FieldView({ game, index, speed, plan = null, director, children }: { game: PlayedGame; index: number; speed: number; plan?: ShotPlan | null; director?: ActionShotDirector; children?: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirRef = useRef<Director | null>(null);
  const lastRef = useRef(-1);
  const begunRef = useRef(-1); // the event whose shot this view started

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let d: Director;
    try { d = new Director(canvas, game, reduced); } catch { return; } // no WebGL: the scorebug and feed still tell the story
    dirRef.current = d;
    lastRef.current = -1;
    d.resize();
    const ro = new ResizeObserver(() => d.resize());
    ro.observe(canvas);
    return () => { ro.disconnect(); d.dispose(); dirRef.current = null; };
  }, [game]);

  useEffect(() => { if (dirRef.current) dirRef.current.speed = speed; }, [speed]);

  useEffect(() => {
    const d = dirRef.current;
    if (!d) return;
    // The director owns each shot's lifecycle: finish the last one, begin this one (once; a skipped or finished shot never replays).
    if (director && begunRef.current >= 0 && begunRef.current !== index && director.active(begunRef.current)) director.finish(begunRef.current, performance.now());
    let p = plan;
    if (director && plan) {
      if (begunRef.current === index) p = plan; // effect re-run (strict mode) for the shot already begun
      else { p = director.begin(index, performance.now()); if (p) begunRef.current = index; }
    }
    d.handle(game.result.events[index], index !== lastRef.current + 1, p, index);
    lastRef.current = index;
  }, [index, game]); // plan is derived from index and the game; it never re-triggers a handle on its own

  return <div className="field"><canvas ref={canvasRef} aria-label="Ballpark view" />{children}</div>;
}
