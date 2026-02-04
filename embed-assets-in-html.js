#!/usr/bin/env node
/**
 * Embeds assets (PNG) as base64 data URLs into the dashboard HTML
 * so the file works when downloaded alone (no assets/ folder needed).
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'compliance_dashboard_v14_roxom (1).html');
const assetsDir = path.join(__dirname, 'assets');

const replacements = [
  { file: 'roxom-wordmark.png', pattern: /src="assets\/roxom-wordmark\.png"/ },
  { file: 'roxom-icon.png', pattern: /src="assets\/roxom-icon\.png"/ },
  { file: 'roxom-tv.png', pattern: /src="assets\/roxom-tv\.png"/ },
];

let html = fs.readFileSync(htmlPath, 'utf8');

for (const { file, pattern } of replacements) {
  const filePath = path.join(assetsDir, file);
  if (!fs.existsSync(filePath)) {
    console.warn('Skip (not found):', file);
    continue;
  }
  const buf = fs.readFileSync(filePath);
  const dataUrl = 'data:image/png;base64,' + buf.toString('base64');
  html = html.replace(pattern, `src="${dataUrl}"`);
  console.log('Embedded:', file);
}

fs.writeFileSync(htmlPath, html);
console.log('Done. HTML updated with embedded assets.');
