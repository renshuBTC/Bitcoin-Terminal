const fs = require('fs');
const JavaScriptObfuscator = require('javascript-obfuscator');

let html = fs.readFileSync('index.html', 'utf8').replace(/\0+$/g, '');

const scriptRegex = /(<script>)([\s\S]*?)(<\/script>)/g;
let parts = [];
let match;

while ((match = scriptRegex.exec(html)) !== null) {
  const jsCode = match[2].trim();
  if (jsCode.length < 200) continue;
  parts.push({
    fullStart: match.index,
    codeStart: match.index + match[1].length,
    codeEnd: match.index + match[1].length + match[2].length,
    fullEnd: match.index + match[0].length,
    code: match[2]
  });
}

console.log(`Found ${parts.length} script blocks to obfuscate`);

for (let i = parts.length - 1; i >= 0; i--) {
  const p = parts[i];
  console.log(`Obfuscating block ${i+1} (${p.code.length} chars)...`);
  
  const result = JavaScriptObfuscator.obfuscate(p.code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.15,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.7,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
  });
  
  const obfuscated = result.getObfuscatedCode();
  console.log(`  -> ${obfuscated.length} chars`);
  html = html.slice(0, p.codeStart) + '\n' + obfuscated + '\n' + html.slice(p.codeEnd);
}

const styleRegex = /(<style>)([\s\S]*?)(<\/style>)/g;
html = html.replace(styleRegex, (full, open, css, close) => {
  const minCss = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
  console.log(`CSS: ${css.length} -> ${minCss.length} chars`);
  return open + minCss + close;
});

html = html.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
html = html.replace(/\n\s*\n/g, '\n');

fs.writeFileSync('index_obfuscated.html', html);

const orig = fs.readFileSync('index.html', 'utf8').replace(/\0+$/g, '');
console.log(`\nOriginal: ${orig.length} chars (${(orig.length/1024).toFixed(0)} KB)`);
console.log(`Obfuscated: ${html.length} chars (${(html.length/1024).toFixed(0)} KB)`);
console.log('Wrote index_obfuscated.html');
