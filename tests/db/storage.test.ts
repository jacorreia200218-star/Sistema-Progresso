import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, buildWorld, expectError, pool, rpc, trailsByArea, type World } from './helpers';

let w: World;
let byArea: Awaited<ReturnType<typeof trailsByArea>>;

beforeAll(async () => {
  w = await buildWorld('ficheiros');
  byArea = await trailsByArea();
});
afterAll(() => pool.end());

const upload = (user: string, bucket: string, name: string, mime = 'image/jpeg') =>
  asUser(user, `insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3) returning name`, [
    bucket, name, JSON.stringify({ mimetype: mime, size: 1234 }),
  ]);

describe('armazenamento privado', () => {
  it('buckets são privados e com limites de tamanho e tipo', async () => {
    const b = await pool.query(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`);
    expect(b.rows.every((x) => x.public === false)).toBe(true);
    expect(b.rows.find((x) => x.id === 'anexos').allowed_mime_types).toContain('application/pdf');
    expect(Number(b.rows.find((x) => x.id === 'fotografias').file_size_limit)).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('fotografia só na própria pasta; visível apenas a quem pode ver o perfil', async () => {
    await upload(w.users.P1, 'fotografias', `${w.users.P1}/foto.jpg`);
    await expectError(upload(w.users.P1, 'fotografias', `${w.users.P2}/foto.jpg`), 'row-level security');
    await rpc(w.users.P1, 'set_my_photo', { p_path: `${w.users.P1}/foto.jpg` });
    await expectError(rpc(w.users.P1, 'set_my_photo', { p_path: `${w.users.P2}/foto.jpg` }), 'inválido');
    const q = `select name from storage.objects where bucket_id = 'fotografias' and name = $1`;
    expect(await asUser(w.users.GuiaA, q, [`${w.users.P1}/foto.jpg`])).toHaveLength(1); // mesma equipa
    expect(await asUser(w.users.P3, q, [`${w.users.P1}/foto.jpg`])).toHaveLength(0); // outra equipa
  });

  it('anexos: carregar só em rascunho próprio; ler só com permissão; imutáveis após submissão', async () => {
    const req = await rpc<string>(w.users.P1, 'create_trail_request', { p_membership: w.members.P1, p_trail: byArea.I[0].id, p_kind: 'normal' });
    await expectError(upload(w.users.P3, 'anexos', `${req}/intruso.pdf`, 'application/pdf'), 'row-level security');
    await upload(w.users.P1, 'anexos', `${req}/oficina.jpg`);
    await expectError(rpc(w.users.P1, 'add_attachment', { p_request: req, p_path: `${req}/naoexiste.jpg`, p_file_name: 'x' }), 'ainda não foi carregado');
    const att = await rpc<string>(w.users.P1, 'add_attachment', { p_request: req, p_path: `${req}/oficina.jpg`, p_file_name: 'oficina.jpg' });
    await rpc(w.users.P1, 'save_request_draft', { p_request: req, p_reflection: 'Dei uma oficina.', p_experiences: '', p_period_start: null, p_period_end: null, p_approximate_date: null });
    await rpc(w.users.P1, 'submit_trail_request', { p_request: req });
    const q = `select name from storage.objects where bucket_id = 'anexos' and name = $1`;
    expect(await asUser(w.users.GuiaA, q, [`${req}/oficina.jpg`])).toHaveLength(1);
    expect(await asUser(w.users.Rui, q, [`${req}/oficina.jpg`])).toHaveLength(1);
    expect(await asUser(w.users.P2, q, [`${req}/oficina.jpg`])).toHaveLength(0);
    expect(await asUser(w.users.GuiaB, q, [`${req}/oficina.jpg`])).toHaveLength(0);
    // Após submissão: sem novos anexos, sem remover nem apagar o ficheiro
    await expectError(upload(w.users.P1, 'anexos', `${req}/depois.jpg`), 'row-level security');
    await expectError(rpc(w.users.P1, 'remove_attachment', { p_attachment: att }), 'rascunho');
    const del = await asUser(w.users.P1, `delete from storage.objects where bucket_id = 'anexos' and name = $1 returning name`, [`${req}/oficina.jpg`]);
    expect(del).toHaveLength(0);
    // Retirar cria nova versão com os mesmos anexos; o ficheiro original continua protegido
    await rpc(w.users.P1, 'withdraw_trail_request', { p_request: req });
    const atts = await asUser(w.users.P1, `select v.version_no from public.attachments a join public.trail_request_versions v on v.id = a.version_id where a.request_id = $1 order by 1`, [req]);
    expect(atts.map((a) => a.version_no)).toEqual([1, 2]);
    const del2 = await asUser(w.users.P1, `delete from storage.objects where bucket_id = 'anexos' and name = $1 returning name`, [`${req}/oficina.jpg`]);
    expect(del2).toHaveLength(0);
  });
});
