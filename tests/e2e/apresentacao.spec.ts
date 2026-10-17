// Capturas para a apresentação aos pioneiros (dados fictícios de teste). Só com APRESENTACAO=1.
import { test } from '@playwright/test';
import { installMock, newUser, pioneer } from './mock-api';

test.skip(!process.env.APRESENTACAO, 'Só com APRESENTACAO=1');
const OUT = '/tmp/claude-0/-home-user-Sistema-Progresso/a81756b8-7639-5e4b-afb4-806636138d68/scratchpad/apresentacao/img';

test('capturas da apresentação', async ({ page, browser }, info) => {
  test.skip(info.project.name !== 'telemovel');
  test.setTimeout(180_000);
  const shot = async (name: string, full = false) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  };
  // Entrar (página pública real, sem dados)
  const pub = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await pub.goto('https://sistema-progresso.vercel.app/entrar');
  await pub.waitForTimeout(1500);
  await pub.screenshot({ path: `${OUT}/01-entrar.png` });
  await pub.close();

  const p2 = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await installMock(p2, newUser());
  await p2.goto('/c/AB7K9M2P');
  await p2.waitForTimeout(1200);
  await p2.screenshot({ path: `${OUT}/02-convite.png` });
  await p2.close();

  await installMock(page, pioneer());
  await page.goto('/'); await page.locator('.stats').waitFor(); await shot('03-inicio');
  await page.goto('/meu-progresso'); await page.locator('.area-card').first().waitFor(); await shot('04-areas');
  await page.goto('/meu-progresso?vista=areas&area=F'); await page.locator('.trail-row').first().waitFor(); await shot('05-trilhos-area');
  await page.goto('/meu-progresso/trilho/intelectual-resolucao-de-problemas?acao=trabalhar'); await page.locator('#escolha').waitFor();
  await page.getByLabel('Como pensas trabalhá-lo? (opcional)').fill('Montar com a equipa um projeto para resolver a falta de material.');
  await shot('06-trabalhar');
  await page.goto('/meu-progresso/trilho/fisico-autoconhecimento?acao=fechar'); await page.locator('#pedido').waitFor();
  await page.getByLabel('Como demonstrei que alcancei este trilho?').fill('No raid ajudei a equipa a adaptar o percurso a um colega com uma lesão. Percebi que aceitar os meus limites e os dos outros também é força.');
  await page.locator('#pedido').scrollIntoViewIfNeeded();
  await shot('07-fechar');
  await page.goto('/meu-progresso/trilho/afetivo-autoestima?acao=fechar'); await page.locator('#pedido').waitFor();
  await page.locator('#pedido').scrollIntoViewIfNeeded(); await shot('08-a-rever');
  await page.goto('/meu-progresso?vista=pedidos'); await page.locator('.request-card').first().waitFor(); await shot('09-pedidos');
  await page.goto('/meu-progresso?vista=validado'); await page.waitForTimeout(800); await shot('10-validado');
  await page.goto('/meu-progresso?vista=caminho'); await page.locator('.summary').waitFor(); await shot('11-percurso');
  await page.goto('/caminho'); await page.waitForTimeout(1200); await shot('12-caminho-seccao');
  await page.goto('/trilhos'); await page.locator('.tree').waitFor();
  await page.locator('.tree-area summary').first().click(); await page.locator('.tree-trail summary').first().click(); await shot('13-trilhos');
  await page.goto('/notificacoes'); await page.waitForTimeout(800); await shot('14-notificacoes');
  await page.goto('/perfil'); await page.waitForTimeout(800); await shot('15-perfil');
  await page.goto('/mais'); await page.waitForTimeout(800); await shot('16-mais');
  await page.goto('/vivencias'); await page.waitForTimeout(800); await shot('17-vivencias');
});
