import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Emit /sw.js with the built asset list baked in; the version changes whenever any asset does. */
function serviceWorker(): Plugin {
  return {
    name: "bb-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const hash = createHash("sha1");
      for (const f of files) hash.update(f);
      const precache = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", ...files.filter((f) => f !== "index.html").map((f) => `/${f}`)];
      const source = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8")
        .replace("__VERSION__", hash.digest("hex").slice(0, 10))
        .replace("__PRECACHE__", JSON.stringify([...new Set(precache)]));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
});
