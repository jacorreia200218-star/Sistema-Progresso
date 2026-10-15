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
    // Fluxo do pedido: áreas → trilhos → objetivos e justificação → enviado
    await page.goto('/meu-progresso');
    await page.locator('.area-card').first().waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/meu-areas-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso?vista=areas&area=F');
    await page.locator('.trail-row').first().waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/meu-area-trilhos-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso/trilho/fisico-autoconhecimento');
    await page.getByLabel('Como demonstrei que alcancei este trilho?').fill('No raid ajudei a equipa a adaptar o percurso a um colega com uma lesão. Percebi que aceitar os meus limites e os dos outros também é força.');
    await flat(page);
    await page.screenshot({ path: `docs/capturas/trilho-pedido-${dev}-${t}.png`, ...full });
    await page.getByRole('button', { name: 'Pedir validação do trilho' }).click();
    await page.getByRole('group', { name: 'Confirmação' }).getByRole('button', { name: 'Pedir validação do trilho' }).click();
    await page.getByText('Pedido enviado.').waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/trilho-enviado-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso?vista=pedidos');
    await page.locator('.request-card').first().waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/meu-pedidos-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso?vista=validado');
    await page.locator('.validated-item').first().waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/meu-validado-${dev}-${t}.png`, ...full });
    await page.goto('/meu-progresso/trilho/afetivo-autoestima');
    await page.locator('#justificacao').waitFor();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/trilho-a-rever-${dev}-${t}.png`, ...full });

    await page.goto('/trilhos');
    await page.locator('.tree').waitFor();
    await page.locator('.tree-area summary').first().click();
    await page.locator('.tree-trail summary').first().click();
    await flat(page);
    await page.screenshot({ path: `docs/capturas/trilhos-${dev}-${t}.png`, ...full });

    const p3 = await page.context().newPage();
    await p3.emulateMedia({ colorScheme: theme });
    await installMock(p3, leader());
    await p3.goto('/revisoes/pedido/r-obj');
    await p3.getByRole('radio', { name: /Devolver para revisão/ }).check();
    await p3.locator('.obj-flags').getByText('E2').click();
    await p3.getByLabel(/Fundamentação/).fill('Fala de um momento em que partilhaste a tua fé com outros.');
    await flat(p3);
    await p3.screenshot({ path: `docs/capturas/revisao-trilho-${dev}-${t}.png`, ...full });
    await p3.goto('/meu-progresso');
    await p3.locator('.person-card').first().waitFor();
    await flat(p3);
    await p3.screenshot({ path: `docs/capturas/pioneiros-grelha-${dev}-${t}.png`, ...full });
    await p3.goto('/acompanhamento/seccao');
    await p3.locator('.list-item').first().waitFor();
    await flat(p3);
    await p3.screenshot({ path: `docs/capturas/acompanhamento-seccao-${dev}-${t}.png`, ...full });
    await p3.goto('/acompanhamento/pedidos');
    await p3.locator('.inbox .type-tag').first().waitFor();
    await flat(p3);
    await p3.screenshot({ path: `docs/capturas/acompanhamento-pedidos-${dev}-${t}.png`, ...full });
    await p3.goto('/acompanhamento/etapas?ver=trilhos');
    await p3.getByText('Comunicação das decisões de trilhos das equipas').waitFor();
    await flat(p3);
    await p3.screenshot({ path: `docs/capturas/acompanhamento-etapas-${dev}-${t}.png`, ...full });
    await p3.goto('/notificacoes');
    await p3.locator('li.notif').first().waitFor();
    await p3.locator('li.notif').nth(0).getByRole('checkbox').check();
    await p3.locator('li.notif').nth(2).getByRole('checkbox').check();
    await flat(p3);
    await p3.screenshot({ path: `docs/capturas/notificacoes-${dev}-${t}.png`, ...full });
    await p3.goto('/meu-progresso?vista=areas&pioneiro=m-p1');
    await p3.locator('.area-card').first().waitFor();
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
