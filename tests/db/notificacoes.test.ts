// Notificações: remoção recuperável só do próprio destinatário, sem duplicados
// e com ligações para as rotas atuais.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, asUser, buildWorld, pool, rpc, trailId, type World } from './helpers';

let w: World;

const add = async (who: string, title: string, read = false, link: string | null = '/pedidos/x') =>
  (await admin(`insert into public.notifications (profile_id, section_id, kind, title, link, read_at) values ($1, $2, 'teste', $3, $4, $5) returning id`,
    [w.users[who], w.section, title, link, read ? new Date() : null]))[0].id as string;
const visible = (who: string) => asUser(w.users[who], `select id, title, read_at from public.notifications order by created_at`);

beforeAll(async () => {
  w = await buildWorld('notificacoes');
  await admin(`delete from public.notifications where section_id = $1`, [w.section]);
});
afterAll(() => pool.end());

describe('remover notificações', () => {
  it('remove uma, várias, as lidas ou todas; só do próprio; Desfazer repõe', async () => {
    const a = await add('P1', 'A');
    const b = await add('P1', 'B', true);
    const c = await add('P1', 'C', true);
    const d = await add('P1', 'D');
    const other = await add('P2', 'Outra');

    // Uma
    expect(await rpc(w.users.P1, 'remove_notifications', { p_scope: 'ids', p_ids: [a] })).toEqual([a]);
    expect((await visible('P1')).map((n) => n.title)).toEqual(['B', 'C', 'D']);
    // Não afeta notificações de outra pessoa, mesmo pedindo o id
    expect(await rpc(w.users.P1, 'remove_notifications', { p_scope: 'ids', p_ids: [other] })).toEqual([]);
    expect(await visible('P2')).toHaveLength(1);
    // Desfazer
    expect(await rpc(w.users.P1, 'restore_notifications', { p_ids: [a] })).toBe(1);
    expect(await rpc(w.users.P2, 'restore_notifications', { p_ids: [a] })).toBe(0);
    expect(await visible('P1')).toHaveLength(4);
    // Várias
    expect((await rpc<string[]>(w.users.P1, 'remove_notifications', { p_scope: 'ids', p_ids: [a, d] })).sort()).toEqual([a, d].sort());
    await rpc(w.users.P1, 'restore_notifications', { p_ids: [a, d] });
    // Lidas
    expect((await rpc<string[]>(w.users.P1, 'remove_notifications', { p_scope: 'lidas' })).sort()).toEqual([b, c].sort());
    expect((await visible('P1')).map((n) => n.title)).toEqual(['A', 'D']);
    // Todas
    expect(await rpc<string[]>(w.users.P1, 'remove_notifications', { p_scope: 'todas' })).toHaveLength(2);
    expect(await visible('P1')).toHaveLength(0);
    expect(await visible('P2')).toHaveLength(1);
    // Ficam guardadas (recuperáveis) e não reaparecem ao voltar a ler
    const kept = await admin(`select count(*)::int n from public.notifications where profile_id = $1 and deleted_at is not null`, [w.users.P1]);
    expect(kept[0].n).toBe(4);
    // Marcar como lidas não toca nas removidas
    await rpc(w.users.P1, 'mark_notifications_read', { p_ids: null });
    expect((await admin(`select read_at from public.notifications where id = $1`, [a]))[0].read_at).toBeNull();
  });

  it('remover notificações não apaga pedidos, decisões nem justificações', async () => {
    const t = await trailId('fisico-desempenho');
    const req = await rpc<string>(w.users.P1, 'create_trail_request', { p_membership: w.members.P1, p_trail: t, p_kind: 'normal' });
    await rpc(w.users.P1, 'submit_trail_validation', { p_request: req, p_expected_version: 1, p_justification: 'Treinei com regularidade.' });
    await rpc(w.users.GuiaA, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: new Date().toISOString().slice(0, 10), p_comment: null });
    await rpc(w.users.P1, 'remove_notifications', { p_scope: 'todas' });
    await rpc(w.users.GuiaA, 'remove_notifications', { p_scope: 'todas' });
    expect(await admin(`select status::text from public.trail_requests where id = $1`, [req])).toEqual([{ status: 'validado_equipa' }]);
    expect(await admin(`select count(*)::int n from public.trail_decisions where request_id = $1`, [req])).toEqual([{ n: 1 }]);
    expect((await admin(`select evidence from public.trail_request_versions where request_id = $1`, [req]))[0].evidence).toContain('Treinei');
  });
});

describe('sem duplicados', () => {
  it('retirar e reenviar o mesmo pedido não repete o aviso por ler ao guia', async () => {
    const t = await trailId('afetivo-autoestima');
    const req = await rpc<string>(w.users.P2, 'create_trail_request', { p_membership: w.members.P2, p_trail: t, p_kind: 'normal' });
    await rpc(w.users.P2, 'submit_trail_validation', { p_request: req, p_expected_version: 1, p_justification: 'Primeira versão.' });
    await rpc(w.users.P2, 'withdraw_trail_request', { p_request: req });
    await rpc(w.users.P2, 'submit_trail_validation', { p_request: req, p_expected_version: 2, p_justification: 'Segunda versão.' });
    const n = await asUser(w.users.GuiaA, `select link from public.notifications where kind = 'pedido_submetido' and link = $1`, [`/revisoes/pedido/${req}`]);
    expect(n).toHaveLength(1);
  });

  it('o guia que é o próprio pioneiro não recebe a comunicação ao Conselho além da decisão', async () => {
    const t = await trailId('carater-autonomia');
    const req = await rpc<string>(w.users.GuiaB, 'create_trail_request', { p_membership: w.members.GuiaB, p_trail: t, p_kind: 'normal' });
    await rpc(w.users.GuiaB, 'submit_trail_validation', { p_request: req, p_expected_version: 1, p_justification: 'Escolhi metas para o ano.' });
    await rpc(w.users.Rui, 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: new Date().toISOString().slice(0, 10), p_comment: null });
    const kinds = (await asUser(w.users.GuiaB, `select kind from public.notifications where body like '%Autonomia%'`)).map((r) => r.kind);
    expect(kinds.filter((k) => k === 'decisao_equipa')).toHaveLength(1);
    expect(kinds).not.toContain('comunicacao_conselho');
  });
});

describe('ligações', () => {
  it('novas notificações e as já guardadas apontam para as rotas atuais', async () => {
    const t = await trailId('espiritual-descoberta');
    const path = await admin(`select id from public.stage_paths where membership_id = $1`, [w.members.P3]);
    if (!path.length) {
      await rpc(w.users.Ana, 'record_adhesion', { p_membership: w.members.P3, p_decided_on: new Date().toISOString().slice(0, 10), p_commitment_on: new Date().toISOString().slice(0, 10), p_notes: null, p_is_historical: false });
      await rpc(w.users.Ana, 'open_stage', { p_membership: w.members.P3, p_stage_key: 'conhecimento', p_insignia_on: null });
    }
    const sp = (await admin(`select id from public.stage_paths where membership_id = $1`, [w.members.P3]))[0].id;
    await rpc(w.users.P3, 'propose_choice', { p_stage_path: sp, p_trail: t, p_planned: null, p_replaces: null });
    const neg = await asUser(w.users.Ana, `select link from public.notifications where kind = 'escolha_proposta'`);
    // A proposta abre diretamente o seu registo
    expect(neg.some((r) => /^\/acompanhamento\/proposta\/[0-9a-f-]{36}$/.test(r.link))).toBe(true);

    const comm = await asUser(w.users.Rui, `select link from public.notifications where kind = 'comunicacao_conselho'`);
    expect(comm.length).toBeGreaterThan(0);
    for (const r of comm) expect(r.link).toBe('/acompanhamento/etapas?ver=trilhos');
    const commGuia = await asUser(w.users.GuiaA, `select link from public.notifications where kind = 'comunicacao_conselho'`);
    for (const r of commGuia) expect(r.link).toBe('/equipa');

    const fn = (kind: string, link: string, who: string) =>
      admin(`select private.notification_link($1, $2, $3, $4) l`, [kind, link, w.users[who], w.section]).then((r) => r[0].l);
    expect(await fn('escolha_proposta', '/dirigentes/negociacao', 'Ana')).toBe('/acompanhamento/pedidos?tipo=negociacao');
    expect(await fn('x', '/dirigentes/historico', 'Ana')).toBe('/acompanhamento/pedidos?tipo=anterior');
    expect(await fn('x', '/acompanhamento/conselho', 'Ana')).toBe('/acompanhamento/etapas');
    expect(await fn('x', '/dirigentes/merito', 'Ana')).toBe('/acompanhamento/seccao?ver=merito');
    expect(await fn('pedido_etapa', '/conselho', 'GuiaA')).toBe('/equipa');
    expect(await fn('x', '/revisoes/pedido/abc', 'GuiaA')).toBe('/revisoes/pedido/abc');
  });
});
