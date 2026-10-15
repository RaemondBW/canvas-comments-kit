// Regenerate src/comments.css from the CSS string in src/comments.js (the source of truth).
//   node scripts/build-css.mjs          write it
//   node scripts/build-css.mjs --check  exit 1 if it is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../src/comments.js', import.meta.url));
const out = fileURLToPath(new URL('../src/comments.css', import.meta.url));

export function cssFromSource(js) {
  const m = js.match(/const CSS = `\n([\s\S]*?)`;/);
  if (!m) throw new Error('CSS string not found in src/comments.js');
  return `/*
 * canvas-comments-kit stylesheet — OPTIONAL, GENERATED from src/comments.js
 * (npm run build:css). Don't edit by hand.
 *
 * comments.js already injects these exact rules at init() time (once, via a
 * <style id="cmt-style">), so most projects need nothing here. Import this file
 * instead only if you prefer your bundler to own the CSS.
 *
 * Theme by overriding the custom properties on :root after this loads.
 */
${m[1]}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const css = cssFromSource(readFileSync(src, 'utf8'));
  if (process.argv.includes('--check')) {
    if (readFileSync(out, 'utf8') !== css) { console.error('src/comments.css is stale — run npm run build:css'); process.exit(1); }
  } else writeFileSync(out, css);
}
