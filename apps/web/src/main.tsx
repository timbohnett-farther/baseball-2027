import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { registerServiceWorker } from "./pwa.ts";
import "./styles.css";

// `/?shot=<moment>` in dev renders the art-review harness instead of the app (scripts/shot.mjs).
const shot = import.meta.env.DEV && new URLSearchParams(location.search).has("shot");
// W35a: dev-only `window.__perfTelemetry()` (perftelemetry.ts); nothing is sent anywhere.
if (import.meta.env.DEV) import("./perftelemetry.ts").then((m) => m.installPerfTelemetry());
if (import.meta.env.DEV) import("./gameplaytelemetry.ts").then((m) => m.installGameplayTelemetry());
const root = createRoot(document.getElementById("root")!);
if (shot) import("./shot.tsx").then(({ ShotView }) => root.render(<ShotView />));
else root.render(<StrictMode><App /></StrictMode>);

if (!shot) registerServiceWorker((apply) => window.dispatchEvent(new CustomEvent("bb-update", { detail: apply })));
