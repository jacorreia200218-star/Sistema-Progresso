// Gestão › Módulos: cargos que dão as permissões de Tesouraria e de Inventário.
// Pessoas FICTÍCIAS, só para teste.
import { expect, test, type Page, type Route } from '@playwright/test';
import { CAPTURAS, THEMES, shoot } from './capturas-util';
import { installMock, leader } from './mock-api';

type Row = Record<string, any>;

async function mockAdmin(page: Page) {
  const calls: { fn: string; body: Row }[] = [];
  const links: { role_id: string; permission: string }[] = [{ role_id: 'r-tes', permission: 'tesouraria.gerir' }];
  const ok = (route: Route, v: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
  await page.route('http://mock.supabase.test/rest/v1/rpc/**', async (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON?.() ?? {};
    if (fn === 'module_admin_overview') {
      return ok(route, ['calendario', 'equipas', 'inventario', 'presencas', 'secretaria', 'tesouraria'].map((k) => ({ module: k, status: 'disponivel', testers: [], grants: [] })));
    }
    if (fn === 'module_role_grants_overview') {
      return ok(route, {
        roles: [{ id: 'r-guia', name: 'Guia' }, { id: 'r-int', name: 'Intendente' }, { id: 'r-tes', name: 'Tesoureiro' }],
        links,
        holders: links.some((l) => l.role_id === 'r-tes')
          ? [{ permission: 'tesouraria.gerir', profile_id: 'u-p1', full_name: 'Pedro Teste', role_name: 'Tesoureiro', team_name: 'Equipa Andorinha' }]
          : [],
      });
    }
    if (fn === 'set_module_role_grant') {
      calls.push({ fn, body });
      const i = links.findIndex((l) => l.role_id === body.p_role && l.permission === body.p_permission);
      if (body.p_on && i < 0) links.push({ role_id: body.p_role, permission: body.p_permission });
      if (!body.p_on && i >= 0) links.splice(i, 1);
      return ok(route, null);
    }
    return route.fallback();
  });
  return calls;
}

test('a administração escolhe que cargos dão cada permissão e vê quem a tem por cargo', async ({ page }) => {
  await installMock(page, leader());
  const calls = await mockAdmin(page);
  await page.goto('/gestao/modulos');
  const main = page.locator('main');
  const tes = main.getByRole('group', { name: 'Cargos que dão «Tesoureiro autorizado»' });
  await expect(tes.getByRole('checkbox', { name: 'Tesoureiro' })).toBeChecked();
  await expect(tes.getByRole('checkbox', { name: 'Intendente' })).not.toBeChecked();
  await expect(main.getByRole('list', { name: 'Com «Tesoureiro autorizado» por cargo' })).toContainText('Pedro Teste · Tesoureiro · Equipa Andorinha');
  // Só Tesouraria e Inventário podem vir de um cargo
  await expect(main.getByRole('group', { name: /Cargos que dão «Gerir cargos»/ })).toHaveCount(0);
  const inv = main.getByRole('group', { name: 'Cargos que dão «Responsável de material»' });
  await inv.getByRole('checkbox', { name: 'Intendente' }).click();
  await expect(main.getByText('«Intendente» passa a dar «Responsável de material».').first()).toBeVisible();
  expect(calls[0].body).toMatchObject({ p_section: 'sec1', p_role: 'r-int', p_permission: 'inventario.gerir', p_on: true });
  await expect(inv.getByRole('checkbox', { name: 'Intendente' })).toBeChecked();
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});

test.describe('capturas', () => {
  test.skip(!CAPTURAS, 'Só com CAPTURAS=1');
  for (const theme of THEMES) {
    test(`gestão de módulos ${theme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme });
      await installMock(page, leader());
      await mockAdmin(page);
      await page.goto('/gestao/modulos');
      await shoot(page, info, theme, 'cargos-permissoes-gestao');
    });
  }
});
