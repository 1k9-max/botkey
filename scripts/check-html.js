const fs = require('node:fs');

function checkHtmlScripts(html, label) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const references = [...html.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map((match) => match[1]);
  const missing = [...new Set(references.filter((id) => !ids.has(id)))];
  if (missing.length) throw new Error(`${label} references missing IDs: ${missing.join(', ')}`);
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
}

const source = fs.readFileSync('nguc3.js', 'utf8');
const panelStart = source.indexOf('const PANEL_HTML = `');
const panelEnd = source.indexOf('`;\n\nfunction sendJson', panelStart);
if (panelStart < 0 || panelEnd < 0) throw new Error('Could not locate PANEL_HTML in nguc3.js.');
checkHtmlScripts(source.slice(panelStart + 'const PANEL_HTML = `'.length, panelEnd), 'Local panel');
checkHtmlScripts(fs.readFileSync('index.html', 'utf8'), 'Admin page');
const publicPage = fs.readFileSync('license.html', 'utf8');
checkHtmlScripts(publicPage, 'Public license page');
if (/admin token|id=["']token["']|id=["']username["']/i.test(publicPage)) {
  throw new Error('The public license page must not expose admin or bot account inputs.');
}
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
if (!vercel.redirects.some((redirect) => redirect.source === '/' && redirect.destination === '/license.html')) {
  throw new Error('Vercel root must serve the public license page.');
}
process.stdout.write('HTML scripts, DOM IDs, and Vercel routing are valid.\n');
