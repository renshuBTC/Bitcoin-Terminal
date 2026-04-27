#!/usr/bin/env node
/**
 * build.js — Obfuscates the JavaScript in src/index.html
 * Usage: node build.js
 * Input:  src/index.html (unobfuscated source)
 * Output: index.html (obfuscated for deployment)
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcPath = path.join(__dirname, 'src', 'index.html');
const outPath = path.join(__dirname, 'index.html');

if (!fs.existsSync(srcPath)) {
  console.error('ERROR: src/index.html not found. Place your unobfuscated source there.');
  process.exit(1);
}

let html = fs.readFileSync(srcPath, 'utf8');

// Find all inline <script>...</script> blocks (skip ones with src attribute)
const scriptRegex = /<script>([\s\S]*?)<\/script>/g;
let match;
let output = '';
let lastIdx = 0;

while ((match = scriptRegex.exec(html)) !== null) {
  const fullMatch = match[0];
  const jsCode = match[1].trim();
  const startIdx = match.index;

  // Append everything before this script tag
  output += html.slice(lastIdx, startIdx);

  // Skip very short scripts (GA inline, etc.) — obfuscate only the main app script
  if (jsCode.length < 500) {
    output += fullMatch;
  } else {
    console.log(`Obfuscating script block (${jsCode.length} chars)...`);
    const obfuscated = JavaScriptObfuscator.obfuscate(jsCode, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      deadCodeInjection: false,
      identifierNamesGenerator: 'hexadecimal',
      renameGlobals: false,
      rotateStringArray: true,
      selfDefending: false,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.75,
      target: 'browser',
      unicodeEscapeSequence: false
    });
    output += '<script>' + obfuscated.getObfuscatedCode() + '</script>';
  }

  lastIdx = startIdx + fullMatch.length;
}

// Append remainder of the file
output += html.slice(lastIdx);

fs.writeFileSync(outPath, output, 'utf8');
const stats = fs.statSync(outPath);
console.log(`Done! Output: index.html (${(stats.size / 1024).toFixed(0)} KB)`);
