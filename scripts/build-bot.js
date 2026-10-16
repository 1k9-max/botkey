const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const JavaScriptObfuscator = require('javascript-obfuscator');

const root = path.resolve(__dirname, '..');

async function build() {
  const bundle = await esbuild.build({
    entryPoints: [path.join(root, 'nguc3.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    packages: 'external',
    write: false
  });
  const code = JavaScriptObfuscator.obfuscate(bundle.outputFiles[0].text, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    target: 'node'
  }).getObfuscatedCode();

  const output = path.join(root, 'bot.js');
  fs.writeFileSync(output, `${code}\n`, 'utf8');
  process.stdout.write(`Đã tạo ${path.relative(root, output)} (${Buffer.byteLength(code)} bytes).\n`);
}

build().catch((error) => {
  process.stderr.write(`Không tạo được bot.js: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});