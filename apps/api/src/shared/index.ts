// Vendored copy of packages/shared, inlined here so this Worker has no
// pnpm-workspace dependency and can be deployed standalone from this
// subdirectory (required for the Cloudflare "Deploy to Cloudflare" button,
// which needs each Worker's subdirectory to be fully self-contained).
// Keep in sync with apps/web/src/types.ts if you change these shapes.
export * from "./schemas.js";
export * from "./cef-defaults.js";
