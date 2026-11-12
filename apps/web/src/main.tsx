import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// `/?shot=<moment>` in dev renders the art-review harness instead of the app (scripts/shot.mjs).
const shot = import.meta.env.DEV && new URLSearchParams(location.search).has("shot");
const root = createRoot(document.getElementById("root")!);
if (shot) import("./shot.tsx").then(({ ShotView }) => root.render(<ShotView />));
else root.render(<StrictMode><App /></StrictMode>);
