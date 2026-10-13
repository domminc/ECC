#!/usr/bin/env node
/**
 * Bundle the page into one HTML file (CSS, data and JS inlined) for publishing
 * as a Claude Artifact. The output has no doctype/html/head/body wrapper
 * because the Artifact host adds its own skeleton.
 *
 * Usage: node apps/policy-fund/tools/build-artifact.js <output.html>
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(APP_DIR, file), 'utf8');

// Keep inlined text from closing its own <script> or <style> element.
const safe = text => text.replace(/<\/(script|style)/gi, '<\\/$1');

// The Artifact host only allows Google Fonts remotely, so the font file is embedded as a data URI.
function inlineFonts(css) {
  return css.replace(/url\("(fonts\/[^"]+\.woff2)"\)/g, (_match, file) => {
    const base64 = fs.readFileSync(path.join(APP_DIR, file)).toString('base64');
    return `url("data:font/woff2;base64,${base64}")`;
  });
}

function buildArtifactHtml() {
  const html = read('index.html');
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  // Keep only remote font stylesheets from the head; local CSS and scripts are inlined below.
  const remoteLinks = (html.match(/<link\b[^>]*href="https:[^"]*"[^>]*>/g) || []).join('\n');
  const bodyMarkup = html
    .match(/<body>([\s\S]*)<\/body>/)[1]
    .replace(/\s*<script src="[^"]+"><\/script>/g, '');

  return [
    `<title>${title}</title>`,
    remoteLinks,
    `<style>\n${safe(inlineFonts(read('styles.css')))}</style>`,
    bodyMarkup.trim(),
    `<script>\n${safe(read('data/funds.js'))}</script>`,
    `<script>\n${safe(read('app.js'))}</script>`,
    ''
  ].join('\n');
}

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node apps/policy-fund/tools/build-artifact.js <output.html>');
    process.exit(1);
  }
  fs.writeFileSync(out, buildArtifactHtml());
  console.log(`Wrote ${out}`);
}

module.exports = { buildArtifactHtml };
