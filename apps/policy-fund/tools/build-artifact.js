#!/usr/bin/env node
/**
 * Bundle the page into one HTML file (CSS, fonts, data, scripts and form files inlined) for publishing
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

// Plain download links are blocked inside the Artifact viewer, so the form files travel with the page as base64.
function formFiles() {
  const data = JSON.parse(read('data/funds.json'));
  const files = {};
  data.forms.forEach(form => {
    [form.blank, form.sample].filter(Boolean).forEach(v => {
      files[v.file] = fs.readFileSync(path.join(APP_DIR, v.file)).toString('base64');
    });
  });
  return files;
}

function scriptSources(html) {
  return Array.from(html.matchAll(/<script src="([^"]+)"><\/script>/g), m => m[1]);
}

function buildArtifactHtml() {
  const html = read('index.html');
  const title = html.match(/<title>([^<]+)<\/title>/)[1];
  // Keep only remote font stylesheets from the head; local CSS and scripts are inlined below.
  const remoteLinks = (html.match(/<link\b[^>]*href="https:[^"]*"[^>]*>/g) || []).join('\n');
  const bodyMarkup = html
    .match(/<body>([\s\S]*)<\/body>/)[1]
    .replace(/\s*<script src="[^"]+"><\/script>/g, '');
  const scripts = scriptSources(html);

  return [
    `<title>${title}</title>`,
    remoteLinks,
    `<style>\n${safe(inlineFonts(read('styles.css')))}</style>`,
    bodyMarkup.trim(),
    `<script>\nwindow.PF_FORM_FILES = ${JSON.stringify(formFiles())};\n</script>`,
    ...scripts.map(src => `<script>\n${safe(read(src))}</script>`),
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

module.exports = { buildArtifactHtml, scriptSources, formFiles };
