import { expect, test, type Browser, type Page } from '@playwright/test';
import { installMock, leader, pioneer } from './mock-api';
import { CAPTURAS, THEMES, shoot } from './capturas-util';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

// O navegador de teste não tem serviço de push: simula-se a subscrição do
// dispositivo, mantendo o resto do percurso real (botões, chamadas, mensagens).
async function fakePush(page: Page, opts: { permission?: NotificationPermission; standalone?: boolean } = {}) {
  await page.addInitScript(({ permission, standalone }) => {
    let sub: { endpoint: string; toJSON(): unknown; unsubscribe(): Promise<boolean> } | null = null;
    const pushManager = {
      getSubscription: async () => sub,
      subscribe: async () => {
        sub = { endpoint: 'https://push.example.invalid/dispositivo', toJSON: () => ({ keys: { p256dh: 'BKey', auth: 'auth' } }), unsubscribe: async () => { sub = null; return true; } };
        return sub;
      },
    };
    const reg = { pushManager };
    const notification = { permission, requestPermission: async () => { notification.permission = 'granted'; return 'granted'; } };
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
    Object.defineProperty(window, 'Notification', { value: notification, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: async () => reg, getRegistration: async () => (sub ? reg : undefined), ready: Promise.resolve(reg) },
      configurable: true,
    });
    if (standalone) Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
  }, { permission: opts.permission ?? 'default', standalone: !!opts.standalone });
  await page.route('**/api/push', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ publicKey: 'BBKonnkN3YEZVQ-FcGShgj84XhhBd6fFDRdO0w0a2qAVxr55Hw1tqie157ugzf5MKFd-ei8-foJRSdpTlE10pFs' }) }));
}

async function device(browser: Browser, userAgent: string, mobile: boolean) {
  const ctx = await browser.newContext({
    userAgent, locale: 'pt-PT',
    ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } }),
  });
  return { ctx, page: await ctx.newPage() };
}

const region = (page: Page) => page.getByRole('region', { name: 'Notificações neste dispositivo' });

test('perfil: por autorizar → ativo, teste e desativar (pioneiro)', async ({ page }, info) => {
  await fakePush(page);
  const mock = await installMock(page, pioneer());
  await page.goto('/perfil');
  const card = region(page);
  await expect(card.locator('.badge')).toHaveText('Por autorizar');
  await expect(card).toContainText('Aceita o pedido');
  await card.getByRole('button', { name: 'Ativar notificações' }).click();
  await expect(card.getByText('Notificações ativadas neste dispositivo.')).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'save_push_subscription')?.body).toMatchObject({ p_endpoint: 'https://push.example.invalid/dispositivo', p_p256dh: 'BKey', p_auth: 'auth' });
  expect(mock.calls.find((c) => c.fn === 'has_push_subscription')?.body).toMatchObject({ p_endpoint: 'https://push.example.invalid/dispositivo' });
  await expect(card.locator('.badge')).toHaveText('Ativo');
  // Nunca promete a entrega com o ecrã bloqueado
  await expect(card).not.toContainText(/garant|sempre/i);
  await card.getByRole('button', { name: 'Enviar notificação de teste' }).click();
  await expect(card.getByText(/Teste enviado ao serviço de notificações/)).toBeVisible();
  expect(mock.calls.some((c) => c.fn === 'send_test_notification')).toBe(true);
  await page.screenshot({ path: `test-results/push-perfil-${info.project.name}.png`, fullPage: true });
  await card.getByRole('button', { name: 'Desativar' }).click();
  await expect(card.getByRole('button', { name: 'Ativar notificações' })).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'remove_push_subscription')?.body).toMatchObject({ p_endpoint: 'https://push.example.invalid/dispositivo' });
  // Autorizado no navegador mas desativado aqui: explica como voltar a ativar
  await expect(card).toContainText('Desativadas neste dispositivo');
});

test('perfil do dirigente com o navegador do computador bloqueado: passos do computador', async ({ browser }) => {
  const { ctx, page } = await device(browser, DESKTOP, false);
  await fakePush(page, { permission: 'denied' });
  const mock = await installMock(page, leader());
  await page.goto('/perfil');
  const card = region(page);
  await expect(card.locator('.badge')).toHaveText('Bloqueado');
  await expect(card).toContainText('Computador');
  await expect(card).toContainText('cadeado ao lado do endereço');
  await expect(card.getByRole('button', { name: 'Ativar notificações' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Verificar de novo' }).click();
  await expect(card.locator('.badge')).toHaveText('Bloqueado');
  expect(mock.calls.some((c) => c.fn === 'save_push_subscription')).toBe(false);
  await ctx.close();
});

test('perfil no Android bloqueado: passos do Android', async ({ browser }) => {
  const { ctx, page } = await device(browser, ANDROID, true);
  await fakePush(page, { permission: 'denied' });
  await installMock(page, pioneer());
  await page.goto('/perfil');
  const card = region(page);
  await expect(card).toContainText('Android');
  await expect(card.locator('.badge')).toHaveText('Bloqueado');
  await expect(card).toContainText('Definições › Apps');
  await ctx.close();
});

test('perfil no iPhone sem a app no ecrã principal: indisponível, explica como instalar', async ({ browser }) => {
  const { ctx, page } = await device(browser, IPHONE, true);
  await installMock(page, pioneer());
  await page.goto('/perfil');
  const card = region(page);
  await expect(card.locator('.badge')).toHaveText('Indisponível');
  await expect(card).toContainText('iPhone ou iPad');
  await expect(card.getByRole('listitem')).toHaveCount(3);
  await expect(card).toContainText('Adicionar ao ecrã principal');
  await expect(card.getByRole('button')).toHaveCount(0);
  await ctx.close();
});

test('perfil no iPhone com a app no ecrã principal: pode ativar', async ({ browser }) => {
  const { ctx, page } = await device(browser, IPHONE, true);
  await fakePush(page, { standalone: true });
  const mock = await installMock(page, pioneer());
  await page.goto('/perfil');
  const card = region(page);
  await expect(card).toContainText('app no ecrã principal');
  await expect(card.locator('.badge')).toHaveText('Por autorizar');
  await card.getByRole('button', { name: 'Ativar notificações' }).click();
  await expect(card.locator('.badge')).toHaveText('Ativo');
  await expect(card).toContainText('confirma com um teste');
  expect(mock.calls.some((c) => c.fn === 'save_push_subscription')).toBe(true);
  await ctx.close();
});

test('perfil num navegador sem notificações: indisponível, sem botões', async ({ page }) => {
  await page.addInitScript(() => { delete (window as { PushManager?: unknown }).PushManager; });
  await installMock(page, pioneer());
  await page.goto('/perfil');
  const card = region(page);
  await expect(card.locator('.badge')).toHaveText('Indisponível');
  await expect(card).toContainText('sino da app');
  await expect(card.getByRole('button')).toHaveCount(0);
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`notificações no perfil ${theme}`, async ({ page, browser }, info) => {
      test.setTimeout(90_000);
      await page.emulateMedia({ colorScheme: theme });
      await fakePush(page);
      await installMock(page, pioneer());
      await page.goto('/perfil');
      await region(page).locator('.badge').waitFor();
      await shoot(page, info, theme, 'perfil-push-por-autorizar');
      await region(page).getByRole('button', { name: 'Ativar notificações' }).click();
      await expect(region(page).locator('.badge')).toHaveText('Ativo');
      await shoot(page, info, theme, 'perfil-push-ativo');
      const mobile = info.project.name === 'telemovel';
      const other = await device(browser, mobile ? IPHONE : DESKTOP, mobile);
      await other.page.emulateMedia({ colorScheme: theme });
      if (!mobile) await fakePush(other.page, { permission: 'denied' });
      await installMock(other.page, leader());
      await other.page.goto('/perfil');
      await region(other.page).locator('.badge').waitFor();
      await shoot(other.page, info, theme, mobile ? 'perfil-push-iphone-instalar' : 'perfil-push-bloqueado');
      await other.ctx.close();
    });
  }
});
