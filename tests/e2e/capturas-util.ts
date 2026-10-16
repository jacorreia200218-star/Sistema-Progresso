// Capturas dos módulos (só com CAPTURAS=1): espera que a página assente, verifica datas,
// deslocamento horizontal e texto sobreposto, e grava a imagem em CAPTURAS_DIR.
import { expect, type Page, type TestInfo } from '@playwright/test';

export const CAPTURAS = !!process.env.CAPTURAS;
const DIR = process.env.CAPTURAS_DIR ?? 'test-results/capturas-modulos';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Datas proibidas na interface: AAAA-MM-DD (fora de campos) e AAAA/MM/DD. */
export async function noIsoDates(page: Page) {
  const bad = await page.evaluate(() => {
    const text = document.querySelector('main')?.innerText ?? document.body.innerText;
    return text.match(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g) ?? [];
  });
  expect(bad, 'datas no formato AAAA-MM-DD').toEqual([]);
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'deslocamento horizontal').toBeLessThanOrEqual(1);
}

export async function settle(page: Page) {
  await page.locator('h1').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.skeleton, .loading, [aria-busy="true"]'), undefined, { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}

export async function shoot(page: Page, info: TestInfo, theme: Theme, name: string, opts: { full?: boolean } = {}) {
  await settle(page);
  await noIsoDates(page);
  await noHorizontalOverflow(page);
  await page.addStyleTag({ content: '.topbar, .bottom-nav { position: static !important; } *, *::before, *::after { animation: none !important; transition: none !important; }' });
  const t = theme === 'light' ? 'claro' : 'escuro';
  await page.screenshot({ path: `${DIR}/${name}-${info.project.name}-${t}.png`, fullPage: opts.full ?? true });
}
