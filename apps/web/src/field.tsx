import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { GameEvent, PlayedGame, Side } from "@bb/sim";

// 3D ballpark that animates the sim's event stream (docs/ARCHITECTURE.md "Graphics and big moments").
// Everything is procedural low-poly: dark navy-black world, one warm key light, a rim light from
// behind-right, dust in the air (docs/VISUAL_DESIGN.md sections 1, 3 and 7). Units are metres, home plate
// at the origin, the outfield toward -z, first base to the right.

type Play = Extract<GameEvent, { type: "play" }>;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FT = 0.3048;
const BASES = [V(0, 0, 0), V(19.4, 0, -19.4), V(0, 0, -38.8), V(-19.4, 0, -19.4)]; // home, 1B, 2B, 3B
const WALL_R = 112;
// pitcher, catcher, 1B, 2B, SS, 3B, LF, CF, RF
const FIELD_POS = [V(0, 0, -18.4), V(0, 0, 2.2), V(17, 0, -24), V(8, 0, -35), V(-8, 0, -35), V(-17, 0, -24), V(-34, 0, -66), V(0, 0, -80), V(34, 0, -66)];
const HOME_LOOK = V(0, 1.2, -26);
const FREEZE = 0.35; // contact freeze (s, real time) for tier 1-2 plays
const SLOWMO = 0.9; // quarter-speed window after the freeze

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const rnd = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const polar = (r: number, a: number) => V(Math.sin(a) * r, 0, -Math.cos(a) * r);

interface Tween { t: number; delay: number; dur: number; fn: (p: number) => void; end?: () => void }

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

function grassTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? "#2c5a3b" : "#316341";
    g.beginPath(); g.arc(256, 256, 256 - i * 10.6, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Muted uniform on the body, saturated team colour only as an accent on the cap (VISUAL_DESIGN 1). */
function makePlayer(color: THREE.Color, bat = false): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color("#6b6f78"), 0.55), roughness: 0.85 });
  const capMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.9, 4, 10), bodyMat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshStandardMaterial({ color: "#a98c76", roughness: 0.8 }));
  head.position.y = 1.85;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.position.y = 1.9;
  for (const m of [body, head, cap]) m.castShadow = true;
  g.add(body, head, cap);
  if (bat) {
    const b = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.95, 8), new THREE.MeshStandardMaterial({ color: "#c9a77a", roughness: 0.6 }));
    stick.position.y = 0.45;
    stick.castShadow = true;
    b.add(stick);
    b.position.set(0.3, 1.45, 0);
    b.rotation.z = -0.45;
    b.name = "bat";
    g.add(b);
  }
  g.userData = { bodyMat, capMat };
  g.scale.setScalar(1.3);
  return g;
}

function recolor(g: THREE.Group, color: THREE.Color) {
  (g.userData.capMat as THREE.MeshStandardMaterial).color.copy(color);
  (g.userData.bodyMat as THREE.MeshStandardMaterial).color.copy(color).lerp(new THREE.Color("#6b6f78"), 0.55);
}

/** Pooled additive particles: dirt and chalk bursts at contact, plus a slow ambient drift. */
class Dust {
  readonly points: THREE.Points;
  private pos: Float32Array; private col: Float32Array; private vel: Float32Array; private life: Float32Array;
  private next = 0;
  constructor(private n: number, private ambient: boolean, size: number, tex: THREE.Texture) {
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (ambient) { this.pos.set([(Math.random() - 0.5) * 50, Math.random() * 9, -Math.random() * 45], i * 3); this.vel.set([0.5 + Math.random() * 0.6, 0.05, 0], i * 3); this.life[i] = 1; }
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
      this.pos.set([origin.x + (Math.random() - 0.5) * 0.4, origin.y, origin.z + (Math.random() - 0.5) * 0.4], i * 3);
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random());
      this.vel.set([Math.cos(a) * s, Math.random() * speed * 0.8, Math.sin(a) * s - speed * 0.2], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.4;
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

type Mode = "home" | "contact" | "chase" | "follow";

class Director {
  speed = 1;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(48, 16 / 9, 0.1, 400);
  private look = HOME_LOOK.clone();
  private mode: Mode = "home";
  private tweens: Tween[] = [];
  private ball: THREE.Mesh;
  private ballFlying = false;
  private fielders: THREE.Group[] = [];
  private batter: THREE.Group | null = null;
  private batterId: number | null = null;
  private runners = new Map<number, THREE.Group & { base?: number }>();
  private half: string | null = null;
  private colors: Record<Side, THREE.Color>;
  private burstDust: Dust; private drift: Dust;
  private rim: THREE.DirectionalLight; private pop: THREE.PointLight;
  private slowT = 99; private slowOn = false; private shake = 0;
  private raf = 0; private last = performance.now();

  constructor(private canvas: HTMLCanvasElement, game: PlayedGame, private reduced: boolean) {
    this.colors = { away: new THREE.Color(game.teams.away.color), home: new THREE.Color(game.teams.home.color) };
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    this.scene.background = new THREE.Color("#0B0D12");
    this.scene.fog = new THREE.FogExp2("#0B0D12", 0.0042);

    // One warm key from upper-left, cool fill at a fifth, rim from behind-right (VISUAL_DESIGN 7.2).
    const key = new THREE.DirectionalLight("#ffd9a0", 2.6);
    key.position.set(-40, 55, 30);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -55, right: 55, top: 70, bottom: -70, near: 1, far: 220 });
    key.target.position.set(0, 0, -30);
    this.rim = new THREE.DirectionalLight("#f2e3c6", 1.2);
    this.rim.position.set(35, 22, -70);
    this.pop = new THREE.PointLight("#f2e3c6", 0, 14);
    this.pop.position.set(0.4, 1.4, 0.8);
    this.scene.add(key, key.target, this.rim, this.pop, new THREE.HemisphereLight("#4a5a86", "#1a1410", 0.5));

    this.buildPark();
    const white = new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.4, emissive: "#443322", emissiveIntensity: 0.4 });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), white);
    this.ball.castShadow = true;
    this.ball.visible = false;
    this.scene.add(this.ball);

    FIELD_POS.forEach((p) => { const f = makePlayer(this.colors.home); f.position.copy(p); this.fielders.push(f); this.scene.add(f); });
    const dust = softSprite("rgba(255,255,255,1)");
    this.burstDust = new Dust(400, false, 0.9, dust);
    this.drift = new Dust(90, true, 0.55, dust);
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
    const grass = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
    flat(new THREE.CircleGeometry(WALL_R, 72, Math.PI / 2 - 1.25, 2.5), grass, 0, 0, 0);
    flat(new THREE.CircleGeometry(24, 48), mat("#5e4a37"), 0, -18.4, 0.01);
    const inner = flat(new THREE.PlaneGeometry(27, 27), mat("#2e5d3d"), 0, -19.4, 0.02); inner.rotation.z = Math.PI / 4;
    flat(new THREE.CircleGeometry(7, 32), mat("#5e4a37"), 0, 0.5, 0.03);
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 0.3, 24), mat("#6b543c")); mound.position.set(0, 0.15, -18.4); mound.receiveShadow = true; this.scene.add(mound);
    const chalk = new THREE.MeshBasicMaterial({ color: "#d9cbb3" });
    for (const s of [-1, 1]) { // foul lines
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, WALL_R * 1.1), chalk);
      line.rotation.set(-Math.PI / 2, 0, s * Math.PI / 4); line.position.set(s * WALL_R * 0.389, 0.04, -WALL_R * 0.389); this.scene.add(line);
    }
    BASES.forEach((b, i) => {
      const m = i === 0 ? new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 5), chalk)
        : new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.6), chalk);
      m.position.set(b.x, 0.07, b.z); if (i) m.rotation.y = Math.PI / 4; this.scene.add(m);
    });
    // Outfield wall and dark stands; stadium lights become bokeh sprites (VISUAL_DESIGN 7.3).
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R, WALL_R, 3, 72, 1, true, Math.PI - 1.25, 2.5), mat("#16322a"));
    wall.position.y = 1.5; (wall.material as THREE.Material).side = THREE.DoubleSide; this.scene.add(wall);
    const stands = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R + 22, WALL_R + 6, 30, 72, 1, true, Math.PI - 1.4, 2.8), mat("#10131a"));
    stands.position.y = 15; (stands.material as THREE.Material).side = THREE.DoubleSide; this.scene.add(stands);
    const warm = softSprite("rgba(255,214,150,1)"), cool = softSprite("rgba(160,190,255,1)");
    for (let i = 0; i < 70; i++) {
      const a = (Math.random() - 0.5) * 2.6, r = WALL_R + 18 + Math.random() * 30;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: Math.random() < 0.8 ? warm : cool, transparent: true, opacity: 0.25 + Math.random() * 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      s.position.set(Math.sin(a) * r, 8 + Math.random() * 34, -Math.cos(a) * r);
      s.scale.setScalar(5 + Math.random() * 12);
      this.scene.add(s);
    }
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
    this.mode = "home"; this.slowOn = false; this.slowT = 99; this.ballFlying = false;
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

  handle(e: GameEvent, jumped: boolean) {
    this.flush();
    this.syncHalf(e);
    if (jumped) this.resync(e);
    this.fielders.forEach((f, i) => f.position.copy(FIELD_POS[i]));
    this.ball.visible = false;
    if (e.type === "pitch") this.onPitch(e);
    else if (e.type === "play") this.onPlay(e);
    else if (e.type === "half_start") this.clearRunners();
  }

  private syncHalf(e: GameEvent) {
    const key = `${e.state.inning}${e.state.half}`;
    if (key === this.half) return;
    this.half = key;
    const bat: Side = e.state.half === "top" ? "away" : "home";
    const def: Side = bat === "away" ? "home" : "away";
    this.fielders.forEach((f) => recolor(f, this.colors[def]));
    this.runners.forEach((r) => recolor(r, this.colors[bat]));
    if (this.batter) { this.scene.remove(this.batter); this.batter = null; this.batterId = null; }
  }

  private battingColor(e: GameEvent) { return this.colors[e.state.half === "top" ? "away" : "home"]; }

  private ensureBatter(e: GameEvent, id: number) {
    if (this.batterId === id && this.batter) { this.batter.rotation.y = 0; this.batter.scale.setScalar(1.3); return; }
    if (this.batter) this.scene.remove(this.batter);
    this.batter = makePlayer(this.battingColor(e), true);
    this.batter.position.set(-0.95, 0, 0.3);
    this.batterId = id;
    this.scene.add(this.batter);
  }

  private clearRunners() { this.runners.forEach((r) => this.scene.remove(r)); this.runners.clear(); }

  private resync(e: GameEvent) {
    this.clearRunners();
    const { first, second, third } = e.state.bases;
    [first, second, third].forEach((id, i) => {
      if (id === null) return;
      const r = makePlayer(this.battingColor(e)) as THREE.Group & { base?: number };
      r.base = i + 1; r.position.copy(BASES[i + 1]); this.scene.add(r); this.runners.set(id, r);
    });
    if (this.batter) { this.scene.remove(this.batter); this.batter = null; this.batterId = null; }
  }

  private swing(delay: number, miss: boolean) {
    const b = this.batter;
    if (!b) return;
    const bat = b.getObjectByName("bat");
    this.tween(0.2, (p) => { b.rotation.y = -2.6 * p; if (bat) bat.rotation.z = -0.45 - 1.0 * p; }, delay);
    if (miss) this.after(delay + 0.25, () => {});
  }

  private onPitch(e: Extract<GameEvent, { type: "pitch" }>) {
    this.ensureBatter(e, e.batterId);
    const bat = this.batter?.getObjectByName("bat");
    if (bat) bat.rotation.z = -0.45;
    const dur = Math.min(0.5, Math.max(0.3, 0.55 - (e.mph - 70) * 0.006));
    const i = e.state.score.away * 7 + e.state.score.home * 3 + e.state.balls * 11 + e.state.strikes * 13 + e.state.outs * 17 + e.mph;
    const side = rnd(i, 3) < 0.5 ? -1 : 1;
    const tx = e.zone ? (rnd(i, 1) - 0.5) * 0.4 : side * (0.3 + rnd(i, 2) * 0.35);
    const ty = e.zone ? 0.5 + rnd(i, 4) * 0.6 : rnd(i, 5) < 0.5 ? 0.2 : 1.3;
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
    const cinematic = !this.reduced && (e.tier === 1 || e.tier === 2);
    const contact = V(0, 1, 0);
    const big = cinematic && (o === "home_run" || o === "triple");
    let delay = 0;

    if (o === "strikeout" || o === "walk") {
      this.syncRunners(e, 0.1);
      return;
    }
    if (cinematic) {
      this.slowOn = true; this.slowT = 0; this.mode = "contact"; this.shake = big ? 0.35 : 0.15; this.pop.intensity = 14;
    }
    this.burstDust.burst(V(0, 0.15, 0.2), cinematic ? 220 : 40, cinematic ? 7 : 3.5);
    this.swing(0, false);
    const ang = (rnd(idx, 1) - 0.5) * 1.35;
    const side = ang < 0 ? -1 : 1;
    let outcomeFielder: THREE.Group | null = null;

    if (o === "home_run") {
      const feet = parseInt(e.stat ?? "400", 10) || 400;
      const to = polar(Math.max(feet * FT, WALL_R + 6), ang * 0.8); to.y = 9;
      this.flight(contact, to, 38 + rnd(idx, 2) * 14, 2.7, delay);
      this.after(delay + 2.7, () => { this.burstDust.burst(V(to.x, 6, to.z), 30, 4); this.ball.visible = false; });
      this.tween(1.6, (p) => this.nearestOF(ang).position.lerpVectors(FIELD_POS[7], polar(WALL_R - 6, ang * 0.8), p * 0.6), delay + 0.4);
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
    }
    delay = 0.35;
    this.syncRunners(e, delay);
    void outcomeFielder;
  }

  /** Move runners (and the batter) to where the sim says they are; scorers go home, outs fade. */
  private syncRunners(e: GameEvent, delay: number) {
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
      const bat = b.getObjectByName("bat"); if (bat) b.remove(bat);
      this.moveTo(runner, BASES[0], 0.01);
      if (batterScored) this.runPath(runner, 0, 4, delay, true);
      else { runner.base = batterBase; this.runners.set(e.batterId, runner); this.runPath(runner, 0, batterBase!, delay, false); }
    } else {
      this.batter = null; this.batterId = null;
      this.fadeOut(b, delay + 0.5);
    }
  }

  private runPath(g: THREE.Object3D, from: number, to: number, delay: number, remove: boolean) {
    for (let b = from; b < to; b++) {
      const a = BASES[b % 4], c = BASES[(b + 1) % 4], k = b - from;
      this.tween(0.5, (p) => g.position.lerpVectors(a, c, p), delay + k * 0.5);
    }
    if (remove) this.after(delay + (to - from) * 0.5 + 0.05, () => this.fadeOut(g, 0));
  }

  // --- render loop -------------------------------------------------------------------------

  private homePos() { return V(0, 4.6, 12.5); }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const real = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let scale = this.speed;
    if (this.slowOn) {
      this.slowT += real;
      const t = this.slowT;
      scale *= t < FREEZE ? 0 : t < FREEZE + SLOWMO ? 0.25 : Math.min(1, 0.25 + (t - FREEZE - SLOWMO) / 0.6 * 0.75);
      if (this.mode === "contact" && t > FREEZE + 0.5) this.mode = "chase";
      if (t > FREEZE + SLOWMO + 0.6) this.slowOn = false;
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
    this.rim.intensity = 1.2 + (this.mode === "contact" ? 1.6 : 0);
    this.updateCamera(real);
    this.renderer.render(this.scene, this.cam);
  };

  private updateCamera(dt: number) {
    let pos = this.homePos(), look = HOME_LOOK.clone(), fov = 48, rate = 2.5;
    const b = this.ball.position;
    if (this.mode === "contact") { pos = V(-1.7, 0.9, 3.3); look = V(0.3, 1.1, 0); fov = 24; rate = 16; }
    else if (this.ballFlying && this.ball.visible) {
      if (this.mode === "chase") { pos = V(b.x * 0.35, Math.max(1.8, b.y * 0.5 + 2.5), b.z + 14); look = b.clone(); fov = 38; rate = 3.5; }
      else { look = HOME_LOOK.clone().lerp(b, 0.55); rate = 3; }
    }
    const k = 1 - Math.exp(-dt * rate);
    this.cam.position.lerp(pos, k);
    this.look.lerp(look, k);
    this.cam.fov += (fov - this.cam.fov) * k;
    this.cam.updateProjectionMatrix();
    if (this.shake > 0.001) {
      this.cam.position.x += (Math.random() - 0.5) * this.shake; this.cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 6);
    }
    this.cam.lookAt(this.look);
  }
}

/** The ballpark. `index` is the current event; a jump of more than one event (skip, replay) re-syncs runners. */
export function FieldView({ game, index, speed }: { game: PlayedGame; index: number; speed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirRef = useRef<Director | null>(null);
  const lastRef = useRef(-1);

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
    d.handle(game.result.events[index], index !== lastRef.current + 1);
    lastRef.current = index;
  }, [index, game]);

  return <div className="field"><canvas ref={canvasRef} aria-label="Ballpark view" /></div>;
}
