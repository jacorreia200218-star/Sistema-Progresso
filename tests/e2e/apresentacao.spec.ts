// Capturas para a apresentação aos pioneiros (dados fictícios de teste). Só com APRESENTACAO=1.
// Todas no mesmo formato de telemóvel (390×844, 3x), sem foco nos campos e com cada
// ecrã enquadrado a partir do início da secção mostrada (nada cortado no topo).
import { test, type Page } from '@playwright/test';
import { installMock, newUser, pioneer } from './mock-api';

test.skip(!process.env.APRESENTACAO, 'Só com APRESENTACAO=1');
const OUT = process.env.APRESENTACAO_DIR ?? '/tmp/claude-0/-home-user-Sistema-Progresso/a81756b8-7639-5e4b-afb4-806636138d68/scratchpad/apresentacao/img';
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

async function settle(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.addStyleTag({ content: '*, *::before, *::after { caret-color: transparent !important; transition: none !important; animation-duration: 0s !important; }' });
  await page.waitForTimeout(500);
}
/** Coloca o elemento logo abaixo da barra de topo. */
async function frame(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const top = document.querySelector('.topbar')?.getBoundingClientRect().height ?? 60;
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - top - 4);
  }, selector);
  await page.waitForTimeout(300);
}

test('capturas da apresentação', async ({ browser }, info) => {
  test.skip(info.project.name !== 'telemovel');
  test.setTimeout(240_000);

  const pub = await browser.newContext(PHONE);
  const p1 = await pub.newPage();
  await p1.goto('https://sistema-progresso.vercel.app/entrar');
  await p1.getByRole('button', { name: 'Entrar' }).waitFor();
  await settle(p1);
  await p1.screenshot({ path: `${OUT}/01-entrar.png` });
  await pub.close();

  const c2 = await browser.newContext(PHONE);
  const p2 = await c2.newPage();
  await installMock(p2, newUser());
  await p2.goto('/c/AB7K9M2P');
  await p2.waitForTimeout(1200);
  await settle(p2);
  await p2.screenshot({ path: `${OUT}/02-convite.png` });
  await c2.close();

  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await installMock(page, pioneer());
  const shot = async (name: string) => { await settle(page); await page.screenshot({ path: `${OUT}/${name}.png` }); };

  await page.goto('/'); await page.locator('.stats').waitFor(); await shot('03-inicio');
  await page.goto('/meu-progresso'); await page.locator('.area-card').first().waitFor(); await shot('04-areas');
  await page.goto('/meu-progresso?vista=areas&area=F'); await page.locator('.trail-row').first().waitFor(); await shot('05-trilhos-area');

  await page.goto('/meu-progresso/trilho/intelectual-resolucao-de-problemas?acao=trabalhar'); await page.locator('#escolha').waitFor();
  await shot('06a-escolher');
  await page.getByLabel('Como pensas trabalhá-lo? (opcional)').fill('Montar com a equipa um projeto para resolver a falta de material.');
  await frame(page, '.trail-actions'); await shot('06-trabalhar');

  await page.goto('/meu-progresso/trilho/fisico-autoconhecimento?acao=fechar'); await page.locator('#pedido').waitFor();
  await page.getByLabel('Como demonstrei que alcancei este trilho?').fill('No raid ajudei a equipa a adaptar o percurso a um colega com uma lesão. Percebi que aceitar os meus limites e os dos outros também é força.');
  await frame(page, '#pedido'); await shot('07-fechar');

  await page.goto('/meu-progresso/trilho/afetivo-autoestima?acao=fechar'); await page.locator('#pedido').waitFor();
  await frame(page, '#pedido'); await shot('08-a-rever');

  await page.goto('/meu-progresso?vista=pedidos'); await page.locator('.request-card').first().waitFor(); await shot('09-pedidos');
  await page.goto('/meu-progresso?vista=validado'); await page.locator('main h1').waitFor(); await shot('10-validado');
  await page.goto('/meu-progresso?vista=caminho'); await page.locator('.summary').waitFor(); await shot('11-percurso');
  await page.goto('/caminho'); await page.locator('main h1').waitFor(); await page.waitForTimeout(1500); await shot('12-caminho-seccao');
  await page.goto('/trilhos'); await page.locator('.tree').waitFor();
  await page.locator('.tree-area summary').first().click(); await page.locator('.tree-trail summary').first().click(); await shot('13-trilhos');
  await page.goto('/notificacoes'); await page.locator('main h1').waitFor(); await shot('14-notificacoes');
  await page.goto('/perfil'); await page.locator('main h1').waitFor(); await shot('15-perfil');
  await page.goto('/vivencias'); await page.locator('main h1').waitFor(); await shot('17-vivencias');
  await ctx.close();
});
