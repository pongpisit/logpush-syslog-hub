import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Run via `npm run build` / `npm run dev:ui` (both `cd` into this directory
// first) so Tailwind/PostCSS config discovery — which searches upward from
// the process's cwd — finds ./tailwind.config.js and ./postcss.config.js.
//
// This app is served by the same Worker as the API (see ../wrangler.jsonc
// `assets.directory`), so the build output goes to ../dist at the project
// root, not ui/dist.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
