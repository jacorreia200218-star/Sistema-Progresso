// Reuniões e tarefas: a migração v2 corre sobre uma base com dados da v1 sem os perder
// (estados «feita» → «concluida» com histórico, «cancelada» arquivada, tarefas sem alterações
// indevidas) e pode voltar a correr sem erros nem duplicados.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_URL, pool } from './helpers';

const MINE = '20261022000600_reunioes_v2.sql';
const here = fileURLToPath(new URL('.', import.meta.url));
const dir = join(here, '../../supabase/migrations');
const url = new URL(DB_URL);
const dbName = `${url.pathname.slice(1)}_mig`;
let db: pg.Client;

const q = async <T = any>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];

beforeAll(async () => {
  await pool.query(`drop database if exists ${dbName} with (force)`);
  await pool.query(`create database ${dbName}`);
  const u = new URL(DB_URL);
  u.pathname = `/${dbName}`;
  db = new pg.Client({ connectionString: u.toString() });
  await db.connect();
  await db.query(readFileSync(join(here, 'supabase-stubs.sql'), 'utf8'));
  // Só as migrações anteriores a esta (o estado da produção antes da v2 deste módulo).
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql') && f < MINE).sort()) {
    await db.query(readFileSync(join(dir, f), 'utf8'));
  }
}, 120_000);

afterAll(async () => {
  await db?.end();
  await pool.query(`drop database if exists ${dbName} with (force)`);
  await pool.end();
});

describe('migração v1 → v2', () => {
  let ids: Record<string, string> = {};

  it('aplica sobre dados v1 e mapeia os estados sem perder informação', async () => {
    const user = (await q(`insert into auth.users (email, raw_user_meta_data) values ('v1.mig@teste.invalid', '{"full_name":"Pessoa V1"}') returning id`))[0].id;
    const section = (await q(`select private.bootstrap_section('Agrupamento V1', 'Pioneiros V1', 'v1.mig@teste.invalid') as id`))[0].id;
    const meeting = (await q(`insert into public.sec_meetings (section_id, space, kind, title, starts_at, created_by)
                              values ($1, 'real', 'animacao', 'Reunião v1', now(), $2) returning id`, [section, user]))[0].id;
    const minute = (await q(`insert into public.sec_minutes (section_id, space, meeting_id, kind, created_by)
                             values ($1, 'real', $2, 'ata', $3) returning id`, [section, meeting, user]))[0].id;
    const ins = async (status: string, changedAt: string | null, note: string | null, kind = 'tarefa') =>
      (await q(`insert into public.sec_items (section_id, space, meeting_id, minute_id, kind, text, responsible_id, due_date, exec_status,
                                              status_note, status_changed_by, status_changed_at, created_by)
                values ($1, 'real', $2, $3, $4, $5, $6, case when $4 = 'tarefa' then current_date + 3 end, $5::text, $7, $8, $9::timestamptz, $6) returning id`,
        [section, meeting, minute, kind, status, user, note, changedAt ? user : null, changedAt]))[0].id;
    ids = {
      feita: await ins('feita', '2026-10-01T10:00:00Z', 'Comprado'),
      cancelada: await ins('cancelada', '2026-10-02T10:00:00Z', null),
      emCurso: await ins('em_curso', '2026-10-03T10:00:00Z', null),
      porFazer: await ins('por_fazer', null, null),
      decisao: await ins('por_fazer', null, null, 'decisao'),
    };
    const before = await q(`select id, text, responsible_id, due_date, status_note, status_changed_at from public.sec_items order by id`);

    await db.query(readFileSync(join(dir, MINE), 'utf8'));

    const st = Object.fromEntries((await q(`select id, exec_status, completed_at, completed_by from public.sec_items`)).map((r) => [r.id, r]));
    expect(st[ids.feita]).toMatchObject({ exec_status: 'concluida', completed_by: user });
    expect(new Date(st[ids.feita].completed_at).toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(st[ids.cancelada].exec_status).toBe('cancelada'); // arquivada, fora do quadro
    expect(st[ids.emCurso].exec_status).toBe('em_curso');
    expect(st[ids.porFazer]).toMatchObject({ exec_status: 'por_fazer', completed_at: null });
    // Texto, responsável, prazo e registo v1 da mudança de estado mantêm-se
    expect(await q(`select id, text, responsible_id, due_date, status_note, status_changed_at from public.sec_items order by id`)).toEqual(before);

    const h = await q(`select item_id, field, from_value, to_value, note, changed_by from public.sec_item_history order by changed_at, from_value nulls first`);
    expect(h.filter((x) => x.item_id === ids.feita).map((x) => [x.from_value, x.to_value])).toEqual([[null, 'feita'], ['feita', 'concluida']]);
    expect(h.find((x) => x.item_id === ids.feita && x.from_value === null).note).toBe('Registo da versão anterior. Comprado');
    expect(h.filter((x) => x.item_id === ids.cancelada).map((x) => x.to_value)).toEqual(['cancelada']);
    expect(h.filter((x) => x.item_id === ids.porFazer)).toEqual([]);
    // Novo estado válido; «feita» deixa de ser aceite na tabela
    await expect(q(`update public.sec_items set exec_status = 'feita' where id = $1`, [ids.porFazer])).rejects.toThrow();
  }, 60_000);

  it('pode voltar a correr sem erros nem entradas duplicadas', async () => {
    const n = async () => (await q(`select count(*)::int as n from public.sec_item_history`))[0].n;
    const before = await n();
    await db.query(readFileSync(join(dir, MINE), 'utf8'));
    expect(await n()).toBe(before);
    expect((await q(`select exec_status from public.sec_items where id = $1`, [ids.feita]))[0].exec_status).toBe('concluida');
  }, 60_000);
});
