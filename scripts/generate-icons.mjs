#!/usr/bin/env node
// Gera os ícones da app (Rosa dos Ventos azul sobre fundo preto) a partir de
// public/rosa-dos-ventos.svg. Uso: node scripts/generate-icons.mjs (usa o Chromium do Playwright).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BG = '#000000';
const src = readFileSync(path.join(root, 'public/rosa-dos-ventos.svg'), 'utf8');
const viewBox = src.match(/viewBox="([^"]+)"/)[1];
const paths = src.match(/<g[\s\S]*<\/g>/)[0];

// scale: fração do lado ocupada pela rosa (menor no ícone «maskable», que é recortado).
const svg = (scale, rounded = false) => {
  const [x, y, w] = viewBox.split(/\s+/).map(Number);
  const side = w / scale;
  const o = (side - w) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x - o} ${y - o} ${side} ${side}">`
    + `<rect x="${x - o}" y="${y - o}" width="${side}" height="${side}"${rounded ? ` rx="${side * 0.2}"` : ''} fill="${BG}"/>${paths}</svg>`;
};

writeFileSync(path.join(root, 'public/icons/icon.svg'), svg(0.72, true) + '\n');

const out = [
  ['apple-touch-icon.png', 180, 0.72],
  ['favicon-32.png', 32, 0.8],
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
  ['icon-maskable-512.png', 512, 0.56],
];
const browser = await chromium.launch(process.env.CI ? {} : { executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const [name, size, scale] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg(scale).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(root, 'public/icons', name), omitBackground: false });
  console.log(`public/icons/${name}`);
}
await browser.close();
