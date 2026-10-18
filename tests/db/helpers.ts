// Utilitários para testar migrações, RLS e RPC num PostgreSQL local com os
// stubs do Supabase (tests/db/supabase-stubs.sql).
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const DB_URL = process.env.PGTEST_DB_URL ?? 'postgresql://postgres@localhost:54329/pioneiros_test';
export const pool = new pg.Pool({ connectionString: DB_URL, max: 10 });

export type Args = Record<string, unknown>;

/** Executa SQL como o utilizador autenticado indicado (role authenticated + JWT sub). */
export async function asUser<T = any>(userId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${userId ? 'authenticated' : 'anon'}`);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId ?? '', role: 'authenticated' })]);
    const res = await client.query(sql, params);
    await client.query('commit');
    return res.rows as T[];
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** Chama uma função RPC (esquema public) com argumentos nomeados. */
export async function rpc<T = any>(userId: string | null, fn: string, args: Args = {}): Promise<T> {
  const keys = Object.keys(args);
  const list = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const rows = await asUser(userId, `select public.${fn}(${list}) as result`, keys.map((k) => args[k]));
  return rows[0]?.result as T;
}

export async function admin<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

export async function createUser(name: string, meta: Record<string, unknown> = {}): Promise<string> {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${randomUUID().slice(0, 8)}@teste.invalid`;
  const rows = await admin<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`,
    [email, JSON.stringify({ full_name: name, ...meta })],
  );
  return rows[0].id;
}

export async function emailOf(userId: string) {
  return (await admin(`select email from auth.users where id = $1`, [userId]))[0].email as string;
}

export const today = () => new Date().toISOString().slice(0, 10);

export async function trailId(key: string): Promise<string> {
  return (await admin(`select id from public.catalog_trails where key = $1`, [key]))[0].id;
}

export async function trailsByArea(): Promise<Record<string, { id: string; key: string }[]>> {
  const rows = await admin(
    `select a.code, t.id, t.key from public.catalog_trails t join public.catalog_areas a on a.id = t.area_id order by a.position, t.position`,
  );
  const out: Record<string, { id: string; key: string }[]> = {};
  for (const r of rows) (out[r.code] ??= []).push({ id: r.id, key: r.key });
  return out;
}

export async function membershipOf(userId: string, sectionId: string): Promise<string> {
  return (await admin(`select id from public.memberships where profile_id = $1 and section_id = $2`, [userId, sectionId]))[0]?.id;
}

/** Espera que a promessa falhe com uma mensagem que contenha o texto indicado. */
/** Entrar numa secção com um código de convite (lança o erro devolvido pelo servidor). */
export async function joinWith(userId: string | null, code: string): Promise<string> {
  const r = await rpc<{ ok: boolean; membership_id?: string; error?: string }>(userId, 'join_section', { p_code: code });
  if (!r.ok) throw new Error(r.error);
  return r.membership_id!;
}

export async function expectError(p: Promise<unknown>, contains: string | RegExp) {
  try {
    await p;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const ok = typeof contains === 'string' ? msg.includes(contains) : contains.test(msg);
    if (!ok) throw new Error(`Erro inesperado: «${msg}» (esperado: ${contains})`);
    return msg;
  }
  throw new Error(`Era esperado um erro (${contains}), mas a operação foi aceite.`);
}

export interface World {
  section: string;
  teamA: string;
  teamB: string;
  users: Record<string, string>; // nome -> auth uid
  members: Record<string, string>; // nome -> membership id
}

/**
 * Cria uma secção nova com: dirigente-admin (Ana), dirigente (Rui), admin técnico
 * (Tecnico), guias A e B, pioneiros P1, P2 (equipa A), P3 (equipa B).
 */
export async function buildWorld(tag: string): Promise<World> {
  const users: Record<string, string> = {};
  for (const n of ['Ana', 'Rui', 'Tecnico', 'GuiaA', 'GuiaB', 'P1', 'P2', 'P3']) users[n] = await createUser(`${n} ${tag}`);
  const anaEmail = await emailOf(users.Ana);
  const section = (await admin(`select private.bootstrap_section($1, $2, $3) as id`, [`Agrupamento ${tag}`, `Pioneiros ${tag}`, anaEmail]))[0].id;
  const teamA = await rpc(users.Ana, 'create_team', { p_section: section, p_name: 'Equipa A' });
  const teamB = await rpc(users.Ana, 'create_team', { p_section: section, p_name: 'Equipa B' });
  const code = await rpc<string>(users.Ana, 'create_invite', {
    p_section: section, p_label: 'Convite geral', p_expires_at: new Date(Date.now() + 86400e3).toISOString(), p_max_uses: 20,
  });
  const plan: Record<string, [string | null, string | null, boolean]> = {
    Rui: ['dirigente', null, false],
    Tecnico: [null, null, true],
    GuiaA: ['guia', teamA, false],
    GuiaB: ['guia', teamB, false],
    P1: ['pioneiro', teamA, false],
    P2: ['pioneiro', teamA, false],
    P3: ['pioneiro', teamB, false],
  };
  const members: Record<string, string> = { Ana: await membershipOf(users.Ana, section) };
  for (const [name, [fn, team, isAdmin]] of Object.entries(plan)) {
    const m = await joinWith(users[name], code);
    if (fn) await rpc(users.Ana, 'approve_membership', { p_membership: m, p_function: fn, p_team: team });
    else {
      await rpc(users.Ana, 'approve_membership', { p_membership: m, p_function: 'dirigente', p_team: null });
      await rpc(users.Ana, 'update_membership', { p_membership: m, p_function: null, p_team: null, p_is_admin: isAdmin, p_reason: 'Administração técnica' });
    }
    members[name] = m;
  }
  return { section, teamA, teamB, users, members };
}

/** Atribui (via dirigente) e confirma um trilho de cada área na etapa. */
export async function confirmAllAreas(w: World, who: string, stagePath: string, offset = 0) {
  const byArea = await trailsByArea();
  const chosen: { id: string; key: string }[] = [];
  for (const code of Object.keys(byArea)) {
    const t = byArea[code][offset];
    const c = await rpc<string>(w.users[who], 'propose_choice', { p_stage_path: stagePath, p_trail: t.id, p_planned: 'Oportunidades previstas', p_replaces: null });
    await rpc(w.users.Ana, 'decide_choice', { p_choice: c, p_accept: true, p_comment: null });
    chosen.push(t);
  }
  return chosen;
}

/** Cria, submete e valida um pedido normal (Equipa e, se for o guia a registar, confirmação dos dirigentes). */
export async function validateTrail(w: World, who: string, trail: string, recorder = 'GuiaA') {
  const req = await rpc<string>(w.users[who], 'create_trail_request', { p_membership: w.members[who], p_trail: trail, p_kind: 'normal' });
  await rpc(w.users[who], 'save_request_draft', { p_request: req, p_reflection: 'Reflexão', p_experiences: 'Vivências', p_period_start: null, p_period_end: null, p_approximate_date: null });
  await rpc(w.users[who], 'submit_trail_request', { p_request: req });
  await rpc(w.users[recorder], 'record_team_decision', { p_request: req, p_expected_version: 1, p_validated: true, p_meeting_date: today(), p_comment: 'Validado em reunião' });
  // Validado por um guia → falta a confirmação de um dirigente.
  if (recorder.startsWith('Guia')) await rpc(w.users.Ana, 'confirm_trail_validation', { p_request: req, p_comment: null });
  return req;
}

/** Módulos: estado, testers e permissões (como a administração, Ana). */
export async function setupModule(
  w: World, module: string, status: 'desenvolvimento' | 'teste' | 'disponivel',
  testers: string[] = [], grants: [string, string][] = [],
) {
  await rpc(w.users.Ana, 'set_module_status', { p_section: w.section, p_module: module, p_status: status });
  for (const t of testers) await rpc(w.users.Ana, 'set_module_tester', { p_section: w.section, p_module: module, p_profile: w.users[t], p_on: true });
  for (const [perm, who] of grants) await rpc(w.users.Ana, 'set_module_grant', { p_section: w.section, p_permission: perm, p_profile: w.users[who], p_on: true });
}

/** Espera que a chamada falhe com uma mensagem que contenha o texto indicado. */
export async function expectDenied(p: Promise<unknown>, text: string | RegExp = /não está disponível|permissão|Reservado|Sem permissão/) {
  let err: unknown;
  try { await p; } catch (e) { err = e; }
  if (!err) throw new Error('Esperava uma recusa, mas a chamada foi aceite.');
  const msg = (err as Error).message;
  if (typeof text === 'string' ? !msg.includes(text) : !text.test(msg)) throw new Error(`Recusa inesperada: ${msg}`);
}

/**
 * Pedido de progresso anterior já existente (criado antes de passar a ser
 * registado só pelos dirigentes): insere o rascunho diretamente, para testar
 * que os pedidos antigos continuam a ser submetidos e decididos.
 */
/** Simula um pedido de progresso anterior já submetido (de antes de só os dirigentes registarem). */
export async function markSubmitted(req: string) {
  await admin(`update public.trail_request_versions set submitted_at = now(), reflection = case when reflection = '' then 'Registo antigo' else reflection end where request_id = $1`, [req]);
  await admin(`update public.trail_requests set status = 'submetido', updated_at = now() where id = $1`, [req]);
}

export async function seedHistorical(w: World, who: string, trail: string): Promise<string> {
  const [r] = await admin<{ id: string }>(
    `insert into public.trail_requests (membership_id, section_id, trail_id, trail_key, kind, created_by)
     select $1, $2, t.id, t.key, 'historico', $3 from public.catalog_trails t where t.id = $4 returning id`,
    [w.members[who], w.section, w.users[who], trail],
  );
  await admin(`insert into public.trail_request_versions (request_id, version_no) values ($1, 1)`, [r.id]);
  return r.id;
}
