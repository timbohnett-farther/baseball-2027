import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { SimTeam } from "@bb/sim";
import { COSMETIC_BY_ID, resolveBatLook, type Cosmetics } from "@bb/shared";
import { dress, disposeJerseys, makePlayer, paintCustom } from "./field.tsx";
import type { CustomLookInfo } from "./customlook.ts";
import { getQuality, QUALITY_PROFILE } from "./quality.ts";

interface Look { color: string; superBat: string | null; cosmetics: Cosmetics }
const teamOf = (l: Look) => ({ abbr: "YOU", color: l.color, lineup: [], gear: { superBat: l.superBat ? { id: l.superBat, name: "", charges: 0, contact: 0, power: 0 } : null, cosmetics: l.cosmetics } }) as unknown as SimTeam;

/**
 * Store try-on (W41): one batter built by the same rig and `dress` the game uses, so a colourway, jersey style or bat skin looks
 * the way it will in play. Its own small canvas and renderer, drawn on demand (no loop), disposed on unmount. Without WebGL it
 * falls back to a flat swatch card.
 */
export function TryOn({ look, custom }: { look: Look; custom?: CustomLookInfo }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const draw = useRef<((l: Look, turn: number, c?: CustomLookInfo) => void) | null>(null);
  const [turn, setTurn] = useState(0);
  const [flat, setFlat] = useState(false);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let r: THREE.WebGLRenderer;
    try { r = new THREE.WebGLRenderer({ canvas: el, antialias: true }); } catch { setFlat(true); return; }
    r.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_PROFILE[getQuality()].pixelRatio));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setSize(el.clientWidth || 300, el.clientHeight || 260, false);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#161a22");
    scene.add(new THREE.HemisphereLight("#ffffff", "#2b3a2b", 1.6));
    const sun = new THREE.DirectionalLight("#fff4dd", 2.2);
    sun.position.set(3, 5, 4); scene.add(sun);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshStandardMaterial({ color: "#3b5d36", roughness: 1 }));
    pad.rotation.x = -Math.PI / 2; scene.add(pad);
    const cam = new THREE.PerspectiveCamera(32, (el.clientWidth || 300) / (el.clientHeight || 260), 0.1, 30);
    cam.position.set(2.5, 1.35, 2.7); cam.lookAt(0, 0.95, 0.1);
    const figure = makePlayer(new THREE.Color("#2e9e5b"), true, 1);
    scene.add(figure);
    draw.current = (l, t, c) => {
      const team = teamOf(l);
      dress(figure, team, null);
      paintCustom(figure, team, c);
      figure.rotation.y = t * (Math.PI / 2);
      r.render(scene, cam);
    };
    return () => {
      draw.current = null;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const x of m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []) x.dispose();
      });
      disposeJerseys();
      r.dispose();
    };
  }, []);

  useEffect(() => { draw.current?.(look, turn, custom); }, [look.color, look.superBat, look.cosmetics, turn, custom?.skin, custom?.build, custom?.accent]); // eslint-disable-line react-hooks/exhaustive-deps

  const bat = resolveBatLook({ superBat: look.superBat, cosmetics: look.cosmetics });
  const worn = (slot: keyof Cosmetics) => COSMETIC_BY_ID[look.cosmetics[slot] ?? ""];
  return (
    <div className="tryon" aria-label="Try-on preview">
      {flat ? (
        <div className="tryon-flat" role="img" aria-label="Preview of your look">
          <span className="tryon-shirt" style={{ background: look.color }} />
          <span className="tryon-bat" style={{ background: bat ? `linear-gradient(90deg, ${bat.color} 60%, ${bat.accent})` : "#c9a06a" }} />
          <small className="muted">{[worn("jersey"), worn("batskin"), worn("helmet"), worn("cleats"), worn("gloves"), worn("celebration")].filter(Boolean).map((c) => c!.name).join(" · ") || "Stock look"}</small>
        </div>
      ) : <canvas ref={canvas} className="tryon-canvas" role="img" aria-label="Your batter wearing the previewed look" />}
      {!flat && <button className="link tryon-turn" onClick={() => setTurn((t) => t + 1)}>Turn</button>}
    </div>
  );
}
