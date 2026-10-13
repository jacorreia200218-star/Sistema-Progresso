// Gera as capturas do Caminho para a documentação (dados fictícios, só de teste).
import { test } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

test.skip(!process.env.CAPTURAS, 'Só com CAPTURAS=1');

for (const theme of ['light', 'dark'] as const) {
  test(`capturas ${theme}`, async ({ page }, info) => {
    const dev = info.project.name;
    const t = theme === 'light' ? 'claro' : 'escuro';
    await page.emulateMedia({ colorScheme: theme });
    await installMock(page, pioneer());
    await page.goto('/caminho');
    await page.locator('.map-card').waitFor();
    await page.screenshot({ path: `docs/capturas/caminho-meu-${dev}-${t}.png`, fullPage: dev === 'computador' });
    if (dev === 'telemovel') {
      await page.addStyleTag({ content: '.topbar, .bottom-nav { position: static !important; }' });
      await page.locator('.map-card').screenshot({ path: `docs/capturas/caminho-meu-mapa-${dev}-${t}.png` });
      await page.locator('.milestone-panel').screenshot({ path: `docs/capturas/caminho-meu-painel-${dev}-${t}.png` });
    }
    const p2 = await page.context().newPage();
    await p2.emulateMedia({ colorScheme: theme });
    await installMock(p2, leader());
    await p2.goto('/caminho?marco=conhecimento');
    await p2.locator('.map-card').waitFor();
    await p2.screenshot({ path: `docs/capturas/caminho-seccao-${dev}-${t}.png`, fullPage: dev === 'computador' });
  });
}
