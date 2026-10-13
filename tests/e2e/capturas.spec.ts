// Gera as capturas do Caminho e do Meu progresso para a documentação (dados fictícios, só de teste).
import { test } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';

test.skip(!process.env.CAPTURAS, 'Só com CAPTURAS=1');

for (const theme of ['light', 'dark'] as const) {
  test(`capturas ${theme}`, async ({ page }, info) => {
    const dev = info.project.name;
    const t = theme === 'light' ? 'claro' : 'escuro';
    await page.emulateMedia({ colorScheme: theme });
    await installMock(page, pioneer());
    await page.goto('/meu-progresso?vista=caminho');
    await page.locator('.summary').waitFor();
    await page.addStyleTag({ content: '.topbar, .bottom-nav { position: static !important; }' });
    await page.screenshot({ path: `docs/capturas/caminho-meu-${dev}-${t}.png`, fullPage: true });
    const full = { fullPage: true };
    await page.goto('/');
    await page.locator('.stats').waitFor();
    await page.addStyleTag({ content: '.topbar, .bottom-nav { position: static !important; }' });
    await page.screenshot({ path: `docs/capturas/inicio-pioneiro-${dev}-${t}.png`, ...full });
    // Em capturas de página inteira, a barra fixa do telemóvel ficaria a meio da imagem.
    const flat = (pg: typeof page) => pg.addStyleTag({ content: '.topbar, .bottom-nav { position: static !important; }' });
    await page.goto('/meu-progresso?vista=areas');
    await page.locator('.area-card').first().waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/meu-areas-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso?vista=areas&area=S');
    await page.locator('.trail-row').first().waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/meu-area-social-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso?vista=pedidos');
    await page.locator('.request-card').first().waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/meu-pedidos-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso/trilho/espiritual-aprofundamento');
    await page.locator('#pedido').waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/trilho-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso/trilho/afetivo-autoestima');
    await page.locator('#pedido .feedback').waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/trilho-devolvido-${dev}-${t}.png`, ...full });

    await page.goto('/trilhos');
    await page.locator('.tree').waitFor();
    await page.locator('.tree-area summary').first().click();
    await page.locator('.tree-trail summary').first().click();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/trilhos-${dev}-${t}.png`, ...full });

    const p3 = await page.context().newPage();
    await p3.emulateMedia({ colorScheme: theme });
    await installMock(p3, leader());
    await p3.goto('/meu-progresso?pioneiro=m-p1');
    await p3.locator('.summary').waitFor();
    await flat(p3);
    await p3.screenshot({ path: `docs/capturas/consulta-dirigente-${dev}-${t}.png`, ...full });

    const p2 = await page.context().newPage();
    await p2.emulateMedia({ colorScheme: theme });
    await installMock(p2, leader());
    await p2.goto('/caminho');
    await p2.locator('.track').waitFor();
    await p2.addStyleTag({ content: '.topbar, .bottom-nav { position: static !important; }' });
    await p2.screenshot({ path: `docs/capturas/caminho-seccao-${dev}-${t}.png`, fullPage: true });
    await p2.goto('/caminho?pessoa=m-p1');
    await p2.locator('.side-panel .faceis-row').first().waitFor();
    await p2.screenshot({ path: `docs/capturas/caminho-painel-${dev}-${t}.png` });
    await p2.goto('/');
    await p2.locator('.stats').waitFor();
    await p2.addStyleTag({ content: '.topbar, .bottom-nav { position: static !important; }' });
    await p2.screenshot({ path: `docs/capturas/inicio-dirigente-${dev}-${t}.png`, fullPage: true });
  });
}
