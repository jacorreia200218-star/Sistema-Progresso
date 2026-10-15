import { expect, test, type Page } from '@playwright/test';
import { installMock, pioneer } from './mock-api';

// O navegador de teste não tem serviço de push: simula-se a subscrição do
// dispositivo, mantendo o resto do percurso real (botões, chamadas, mensagens).
async function fakePush(page: Page) {
  await page.addInitScript(() => {
    let sub: { endpoint: string; toJSON(): unknown; unsubscribe(): Promise<boolean> } | null = null;
    const pushManager = {
      getSubscription: async () => sub,
      subscribe: async () => {
        sub = { endpoint: 'https://push.example.invalid/dispositivo', toJSON: () => ({ keys: { p256dh: 'BKey', auth: 'auth' } }), unsubscribe: async () => { sub = null; return true; } };
        return sub;
      },
    };
    const reg = { pushManager };
    Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
    Object.defineProperty(window, 'Notification', { value: { permission: 'default', requestPermission: async () => 'granted' }, configurable: true });
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: async () => reg, getRegistration: async () => (sub ? reg : undefined), ready: Promise.resolve(reg) },
      configurable: true,
    });
  });
  await page.route('**/api/push', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ publicKey: 'BBKonnkN3YEZVQ-FcGShgj84XhhBd6fFDRdO0w0a2qAVxr55Hw1tqie157ugzf5MKFd-ei8-foJRSdpTlE10pFs' }) }));
}

test('perfil: ativar notificações, enviar teste e desativar', async ({ page }, info) => {
  await fakePush(page);
  const mock = await installMock(page, pioneer());
  await page.goto('/perfil');
  const card = page.getByRole('region', { name: 'Notificações no telemóvel' });
  await expect(card).toContainText('Recebe um aviso no telemóvel');
  await card.getByRole('button', { name: 'Ativar notificações' }).click();
  await expect(card.getByText('Notificações ativadas neste dispositivo.')).toBeVisible();
  expect(mock.calls.find((c) => c.fn === 'save_push_subscription')?.body).toMatchObject({ p_endpoint: 'https://push.example.invalid/dispositivo', p_p256dh: 'BKey', p_auth: 'auth' });
  await expect(card).toContainText('Ativas neste dispositivo');
  await card.getByRole('button', { name: 'Enviar notificação de teste' }).click();
  await expect(card.getByText(/Notificação de teste enviada/)).toBeVisible();
  expect(mock.calls.some((c) => c.fn === 'send_test_notification')).toBe(true);
  await page.screenshot({ path: `test-results/push-perfil-${info.project.name}.png`, fullPage: true });
  await card.getByRole('button', { name: 'Desativar' }).click();
  await expect(card.getByRole('button', { name: 'Ativar notificações' })).toBeVisible();
  expect(mock.calls.some((c) => c.fn === 'remove_push_subscription')).toBe(true);
});

test('perfil no iPhone sem a app no ecrã principal: explica como instalar', async ({ browser }) => {
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 }, locale: 'pt-PT',
  });
  const page = await ctx.newPage();
  await installMock(page, pioneer());
  await page.goto('/perfil');
  const card = page.getByRole('region', { name: 'Notificações no telemóvel' });
  await expect(card).toContainText('Adicionar ao ecrã principal');
  await expect(card.getByRole('button')).toHaveCount(0);
  await ctx.close();
});
