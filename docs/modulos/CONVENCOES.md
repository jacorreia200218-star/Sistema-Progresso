# Convenções dos módulos (Calendário, Inventário, Tesouraria, Equipas e cargos, Secretaria)

Interface e mensagens em **português de Portugal**. Ler primeiro:
`supabase/migrations/20261021000100_modulos_base.sql`, `src/modules/common.ts`, `src/modules/ModuleShell.tsx`,
`src/modules/files.ts`, `tests/db/modulos.test.ts`, `tests/db/helpers.ts` (`buildWorld`, `setupModule`, `expectDenied`).

## Servidor (Supabase/PostgreSQL)
- Uma migração por módulo: `supabase/migrations/20261021000X00_<modulo>.sql` (Calendário 0200 — já tem `cal_events`;
  Inventário 0300; Tesouraria 0400; Equipas 0500; Secretaria 0600). Aditiva: nunca alterar nem apagar dados existentes.
- Tabelas com o prefixo do módulo (`cal_`, `inv_`, `fin_`, `eq_`, `sec_`), **todas com `section_id` e `space`**
  (`check (space in ('teste','real'))`), `enable row level security` e **sem políticas**.
- Leitura e escrita só por funções `public.<prefixo>_*` `security definer set search_path = ''` que começam com
  `v_space := private.module_require(p_section, '<modulo>')` (ou `private.module_require_can(p_section, '<modulo>', '<permissão>', <dirigente_ok>)`)
  e filtram SEMPRE `where section_id = p_section and space = v_space`. Ao receber um id, confirmar que o registo pertence a
  essa secção e a esse espaço (senão: «Registo não encontrado.»).
- Permissões: ser tester só dá acesso. Editar/gerir exige `private.has_grant(section, '<modulo>.<perm>')` (ver
  `module_grants`) ou, onde o pedido o permite, `private.is_dirigente(section)`. Nunca dar permissões por cargo de equipa.
- Mensagens de erro claras em português (`raise exception '...'`), com `errcode = '42501'` para falta de permissão.
- Notificações: `private.module_notify(section, '<modulo>', space, array[profiles], kind, title, body, link)` (no espaço de
  teste só chega a testers, com «[Teste]»). Em Tesouraria e Secretaria o `body` NÃO pode ter valores, nomes de pagamentos
  nem conteúdo de atas (aparece no ecrã bloqueado): usar texto genérico.
- Lembretes: `private.schedule_reminder(...)` (único por entidade/tipo/pessoa; reagendar = chamar de novo) e
  `private.cancel_reminders(entity, entity_id[, profile])`.
- Anexos: definir `private.<modulo>_file_access(p_entity text, p_entity_id uuid, p_write boolean) returns boolean`
  (security definer, stable) — a base chama-a para reservar caminho (`module_file_prepare`), ler e retirar. Cliente: `src/modules/files.ts`.
- Auditoria: quem criou/alterou/anulou e quando (colunas `created_by/created_at/updated_by/...` e/ou `private.audit(...)`).
- Preferir anular/corrigir a apagar. Concorrência: `select ... for update` nas linhas certas antes de validar disponibilidade.
- Terminar a migração com:
  `revoke execute on all functions in schema public from public, anon; grant execute on all functions in schema public to authenticated;`
- Não editar a migração base nem migrações de outros módulos. Se precisares de mudar a base, diz no relatório final.

## Interface (React 19 + TS + react-router v7 + @tanstack/react-query)
- Ponto de entrada: `src/modules/<modulo>/index.tsx` (já existe, substitui o conteúdo) — `<ModuleShell module="...">` com
  `<Routes>` internas (caminhos relativos: a rota é `/<caminho>/*`). Caminhos: `/calendario`, `/inventario`, `/tesouraria`,
  `/equipas-e-cargos`, `/secretaria`.
- `useModuleCtx()` dá `space`, `isTest` e `can(perm, dirigenteOk)` — só para mostrar/esconder; o servidor decide.
- Leituras com `useQuery` + `call('<rpc>', {...})` de `src/lib/api.ts`; escritas com `useAction()` de `src/lib/useAction.ts`
  (mostra erro/sucesso só depois do servidor responder). Componentes em `src/components/ui.tsx` (PageTitle, Field, Notice,
  ErrorBox, Loading, Empty, Badge, ConfirmButton). Datas e euros em `src/modules/common.ts` (Europe/Lisbon, DD/MM/AAAA,
  cêntimos inteiros). Membros/equipas: `useMembers`, `useTeams` de `src/lib/hooks.ts`.
- Estilos do módulo em `src/modules/<modulo>/<modulo>.css` (importado no index). Reaproveitar classes existentes
  (`card`, `list`, `list-item`, `btn`, `btn secondary`, `btn ghost`, `row`, `grid-2`, `field`, `faint`, `prose`, `badge tone-*`, `tabs`/`tab`).
- Design: Arial, compacto mas arejado, cores suaves, modo escuro (usar variáveis CSS), parágrafos explicativos `prose`
  (justificados), cartões e indicadores centrados, formulários simples com validação clara, estados vazios úteis sem dados
  fictícios. Pesquisa e filtros no URL (`useSearchParams`, construindo a partir de `window.location.search`) para sobreviverem
  ao «voltar». Funcionar a 390 px de largura sem deslocamento horizontal.
- Não editar `App.tsx`, `Layout.tsx`, `common.ts`, `ModuleShell.tsx`, `styles.css` nem `mock-api.ts`.

## Testes
- BD: `tests/db/<modulo>.test.ts` com `buildWorld('<modulo>')` + `setupModule(...)`. Cobrir: administração, tester editor,
  tester só consulta, membro sem acesso (recusado), isolamento teste/real, regras do módulo. Correr com
  `PGTEST_DB=<db_próprio> PGTEST_DB_URL=postgresql://postgres@localhost:54329/<db_próprio> npm run test:db -- tests/db/<modulo>.test.ts`
  (o PostgreSQL local já está a correr na porta 54329; usa SEMPRE a tua base própria).
- Interface: `tests/e2e/<modulo>.spec.ts`, com `installMock(page, leader()/pioneer())` de `tests/e2e/mock-api.ts` e, a seguir,
  um `page.route('http://mock.supabase.test/rest/v1/rpc/**', ...)` próprio para as RPC do módulo (regista DEPOIS do
  installMock; chama `route.fallback()` para as restantes). `my_modules` tem de devolver o acesso ao módulo.
  Correr com `PW_PORT=<porta_própria> npx playwright test <modulo>`. Testar telemóvel e computador.
- `npx tsc -b` e `npm test` têm de passar.
