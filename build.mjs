// Build sin CRXJS: esbuild produce bundles IIFE AUTOCONTENIDOS (un archivo cada
// uno, sin imports dinamicos). Asi el content script corre directo en el mundo
// aislado, sin depender del CSP de Botmaker (que rompia el loader de CRXJS).

import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const watch = process.argv.includes('--watch');
const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const outdir = 'dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/sidepanel`, { recursive: true });

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: 'iife', // autocontenido, sin import() dinamico
  target: 'chrome116',
  logLevel: 'info',
  legalComments: 'none',
  alias: { '@': srcDir },
};

const builds = [
  { entryPoints: ['src/content/index.ts'], outfile: `${outdir}/content.js`, ...common },
  { entryPoints: ['src/background/index.ts'], outfile: `${outdir}/background.js`, ...common },
  { entryPoints: ['src/sidepanel/main.ts'], outfile: `${outdir}/sidepanel/main.js`, ...common },
];

async function copyStatics() {
  await cp('src/manifest.json', `${outdir}/manifest.json`);
  await cp('src/sidepanel/index.html', `${outdir}/sidepanel/index.html`);
  await cp('src/sidepanel/styles.css', `${outdir}/sidepanel/styles.css`);
  await cp('public/icons', `${outdir}/icons`, { recursive: true });
}

if (watch) {
  const ctxs = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(ctxs.map((c) => c.watch()));
  await copyStatics();
  console.log('esbuild: watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  await copyStatics();
  console.log('Build OK -> dist/');
}
