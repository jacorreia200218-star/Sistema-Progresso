// Ficha de um artigo: estado atual, peças, empréstimos, reservas, histórico e ações
// (emprestar/pedir, reservar, entradas e saídas, estados, peças, editar, arquivar).
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Pencil } from 'lucide-react';
import { call } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { useAction } from '../../lib/useAction';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { listModuleFiles } from '../files';
import { useModuleCtx } from '../ModuleShell';
import { LoanCard, LoanForm, ReservationCard, ReservationForm, Section, StateBadges, useFormAction } from './parts';
import { PurchaseCard, PurchaseForm } from './Comprar';
import {
  CONSERVATION_LABEL, CONSERVATION_TONE, MOVEMENT_LABEL, PIECE_LABEL, PIECE_TONE, STATE_LABEL, placeParts, qty, useItem, useOverview, useSectionId, when,
  type Condition, type ItemDetail, type Piece,
} from './api';

type Panel = 'emprestar' | 'pedir' | 'reservar' | 'stock' | 'estado' | 'peca' | 'comprar' | null;

export function Artigo() {
  const { id } = useParams();
  const q = useItem(id);
  const ov = useOverview();
  const me = ov.data?.me ?? '';
  const [panel, setPanel] = useState<Panel>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const toggle = (p: Panel) => { setFlash(null); setPanel(panel === p ? null : p); };
  const done = (msg?: string) => { setPanel(null); setFlash(msg ?? null); };
  if (q.isLoading) return <Loading />;
  if (q.error) return <><PageTitle title="Artigo" back="/inventario" /><ErrorBox error={q.error} retry={() => q.refetch()} /></>;
  const it = q.data!;
  const s = it.stock;
  const manage = it.can_manage;
  const archived = !!it.archived_at;
  return (
    <div className="inv-page">
      <PageTitle title={it.name} back="/inventario"
        subtitle={<>{it.category ?? 'Sem tipo'}{it.location && <> · <MapPin size={13} aria-hidden="true" className="inv-pin" />{it.location}</>}</>} />
      {archived && <Notice kind="warn">Artigo arquivado em {when(it.archived_at!)}. O histórico mantém-se.</Notice>}
      <div className="inv-head">
        {it.has_photo && <Photo itemId={it.id} name={it.name} />}
        <div className="inv-head-text">
          {it.description && <p className="prose">{it.description}</p>}
          <div className="row inv-badges">
            <StateBadges states={s.states} />
            {it.condition && <Badge label={`Conservação: ${CONSERVATION_LABEL[it.condition].toLowerCase()}`} tone={CONSERVATION_TONE[it.condition]} />}
            {it.tracking === 'pecas' && <Badge label="Peças identificadas" tone="neutral" />}
          </div>
          {placeParts(it).length > 0 && (
            <dl className="inv-dl inv-place-dl" aria-label="Onde está guardado">
              {placeParts(it).map((p) => <div key={p.label}><dt>{p.label}</dt><dd>{p.value}</dd></div>)}
            </dl>
          )}
          {it.notes && <p className="prose inv-notes"><span className="faint">Observações: </span>{it.notes}</p>}
        </div>
      </div>
      <ul className="stats inv-stats" aria-label="Quantidades">
        <li><div className="stat stat-verde"><span className="stat-value">{s.available}</span><span className="stat-label">Disponível</span><span className="stat-hint">de {qty(s.total, it.unit)}</span></div></li>
        <li><div className="stat stat-azul"><span className="stat-value">{s.lent}</span><span className="stat-label">Emprestado</span></div></li>
        <li><div className="stat stat-lilas"><span className="stat-value">{s.reserved}</span><span className="stat-label">Reservado agora</span>{s.reservations > 0 && <span className="stat-hint">{s.reservations} {s.reservations === 1 ? 'reserva' : 'reservas'}</span>}</div></li>
        <li><div className="stat stat-ambar"><span className="stat-value">{s.damaged + s.repair}</span><span className="stat-label">Danificado ou em reparação</span>{it.min_quantity != null && <span className="stat-hint">Mínimo: {qty(it.min_quantity, it.unit)}</span>}</div></li>
      </ul>

      {!archived && (
        <div className="btn-row inv-actions">
          {manage ? (
            <>
              <button type="button" className="btn" aria-expanded={panel === 'emprestar'} onClick={() => toggle('emprestar')}>Emprestar</button>
              <button type="button" className="btn secondary" aria-expanded={panel === 'reservar'} onClick={() => toggle('reservar')}>Reservar</button>
              {it.tracking === 'quantidade' ? (
                <>
                  <button type="button" className="btn secondary" aria-expanded={panel === 'stock'} onClick={() => toggle('stock')}>Entrada ou saída</button>
                  <button type="button" className="btn secondary" aria-expanded={panel === 'estado'} onClick={() => toggle('estado')}>Mudar estado</button>
                </>
              ) : (
                <button type="button" className="btn secondary" aria-expanded={panel === 'peca'} onClick={() => toggle('peca')}>Acrescentar peça</button>
              )}
              <button type="button" className="btn secondary" aria-expanded={panel === 'comprar'} onClick={() => toggle('comprar')}>Pôr na lista «A comprar»</button>
              <Link to={`/inventario/artigo/${it.id}/editar`} className="btn ghost"><Pencil size={16} aria-hidden="true" /> Editar</Link>
            </>
          ) : (
            <button type="button" className="btn" aria-expanded={panel === 'pedir'} onClick={() => toggle('pedir')}>Pedir empréstimo</button>
          )}
        </div>
      )}
      {flash && <Notice kind="success">{flash}</Notice>}
      {panel === 'emprestar' && <LoanForm item={it} mode="emprestar" onDone={done} />}
      {panel === 'pedir' && <LoanForm item={it} mode="pedir" onDone={done} />}
      {panel === 'reservar' && <ReservationForm item={it} onDone={done} />}
      {panel === 'stock' && <StockForm it={it} onDone={done} />}
      {panel === 'estado' && <ConditionForm it={it} onDone={done} />}
      {panel === 'peca' && <PieceForm it={it} onDone={done} />}
      {panel === 'comprar' && <PurchaseForm item={it} onDone={done} />}

      {it.tracking === 'pecas' && (
        <Section title="Peças" count={it.pieces.length}>
          {it.pieces.length === 0 ? <div className="card"><Empty title="Ainda não há peças registadas." /></div> : (
            <ul className="card list" aria-label="Peças">
              {it.pieces.map((p) => <PieceRow key={p.id} p={p} manage={manage && !archived} />)}
            </ul>
          )}
        </Section>
      )}

      <Section title="Empréstimos e pedidos" count={it.loans.filter((l) => l.status === 'ativo' || l.status === 'pedido').length}>
        {it.loans.length === 0 ? <p className="faint">Sem empréstimos nos últimos 90 dias.</p> : (
          <ul className="inv-cards">{it.loans.map((l) => <LoanCard key={l.id} l={l} canManage={manage} me={me} showItem={false} />)}</ul>
        )}
      </Section>

      <Section title="Reservas" count={it.reservations.length}>
        {it.reservations.length === 0 ? <p className="faint">Sem reservas ativas.</p> : (
          <ul className="inv-cards">{it.reservations.map((r) => <ReservationCard key={r.id} r={r} canManage={manage} showItem={false} />)}</ul>
        )}
      </Section>

      {it.purchases.length > 0 && (
        <Section title="Compras" count={it.purchases.filter((p) => p.status === 'por_comprar').length}>
          <ul className="inv-cards">{it.purchases.map((p) => <PurchaseCard key={p.id} p={p} canManage={manage} finOk={!!ov.data?.fin_ok} />)}</ul>
        </Section>
      )}

      <Section title="Histórico">
        {it.movements.length === 0 ? <p className="faint">Sem movimentos.</p> : (
          <ol className="card list inv-history" aria-label="Histórico de movimentos">
            {it.movements.map((m) => (
              <li key={m.id} className="inv-mov">
                <div className="row between">
                  <strong>{MOVEMENT_LABEL[m.kind] ?? m.kind}{m.quantity != null && m.kind !== 'criacao' ? ` · ${m.quantity > 0 && m.kind === 'ajuste' ? '+' : ''}${m.quantity}` : ''}</strong>
                  <span className="faint">{when(m.at)}</span>
                </div>
                <span className="faint">
                  {[m.piece && `Peça ${m.piece}`, transition(m.from_state, m.to_state, m.kind), m.note, m.actor && `por ${m.actor}`].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {manage && <ArchiveBox it={it} />}
    </div>
  );
}

function transition(from: string | null, to: string | null, kind: string) {
  if (!from && !to) return null;
  const label = (s: string | null) => (s ? (PIECE_LABEL[s] ?? s) : '—');
  if (kind === 'entrada' || kind === 'saida' || kind === 'ajuste') return from && to ? `${from} → ${to}` : null;
  if (kind === 'prazo') return `${from} → ${to}`;
  return `${label(from)} → ${label(to)}`;
}

function Photo({ itemId, name }: { itemId: string; name: string }) {
  const section = useSectionId();
  const q = useQuery({
    queryKey: ['inv', 'photo', section, itemId],
    queryFn: async () => {
      const files = (await listModuleFiles(section, 'inventario', 'item', itemId)).filter((f) => f.mime.startsWith('image/'));
      const last = files[files.length - 1];
      if (!last) return null;
      const { data } = await supabase.storage.from('modulos').createSignedUrl(last.path, 3600);
      return data?.signedUrl ?? null;
    },
    staleTime: 50 * 60_000,
  });
  if (!q.data) return null;
  return <img className="inv-photo" src={q.data} alt={`Fotografia de ${name}`} />;
}

function StockForm({ it, onDone }: { it: ItemDetail; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const [kind, setKind] = useState<'entrada' | 'saida' | 'ajuste'>('entrada');
  const [n, setN] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const v = Number(n);
    if (n.trim() === '' || !Number.isInteger(v) || v < 0 || (kind !== 'ajuste' && v === 0)) return setErr('Indica uma quantidade válida (número inteiro).');
    if (kind === 'ajuste' && !note.trim()) return setErr('Explica o motivo do ajuste.');
    await action.run(() => call('inv_stock_move', { p_section: section, p_item: it.id, p_kind: kind, p_quantity: v, p_note: note || null }),
      kind === 'entrada' ? 'Entrada registada.' : kind === 'saida' ? 'Saída registada.' : 'Quantidade ajustada.');
  };
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Entrada ou saída">
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={action.error} />
      <fieldset className="radio-row">
        <legend className="label">Movimento</legend>
        {([['entrada', 'Entrada (compra, oferta)'], ['saida', 'Saída (perda, consumo, abate)'], ['ajuste', 'Ajuste (contagem)']] as const).map(([k, l]) => (
          <label key={k} className="radio"><input type="radio" name="inv-kind" checked={kind === k} onChange={() => setKind(k)} /> {l}</label>
        ))}
      </fieldset>
      <Field label={kind === 'ajuste' ? `Quantidade total contada (${it.unit}); atual: ${it.stock.total}` : `Quantidade (${it.unit})`} htmlFor="inv-stock-q">
        <input id="inv-stock-q" type="number" inputMode="numeric" min={0} value={n} onChange={(e) => setN(e.target.value)} />
      </Field>
      <Field label={kind === 'ajuste' ? 'Motivo' : 'Nota (opcional)'} htmlFor="inv-stock-n">
        <input id="inv-stock-n" type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Registar</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

function ConditionForm({ it, onDone }: { it: ItemDetail; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const [from, setFrom] = useState<Condition>('disponivel');
  const [to, setTo] = useState<Condition>('reparacao');
  const [n, setN] = useState('1');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const labels: Record<Condition, string> = { disponivel: STATE_LABEL.disponivel, danificado: STATE_LABEL.danificado, reparacao: STATE_LABEL.reparacao };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const v = Number(n);
    if (from === to) return setErr('Escolhe estados diferentes.');
    if (!Number.isInteger(v) || v < 1) return setErr('Indica uma quantidade igual ou superior a 1.');
    await action.run(() => call('inv_set_condition', { p_section: section, p_item: it.id, p_from: from, p_to: to, p_quantity: v, p_note: note || null }), 'Estado atualizado.');
  };
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Mudar estado">
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={action.error} />
      <div className="grid-2">
        <Field label="De" htmlFor="inv-c-from">
          <select id="inv-c-from" value={from} onChange={(e) => setFrom(e.target.value as Condition)}>
            {(Object.keys(labels) as Condition[]).map((c) => <option key={c} value={c}>{labels[c]}</option>)}
          </select>
        </Field>
        <Field label="Para" htmlFor="inv-c-to">
          <select id="inv-c-to" value={to} onChange={(e) => setTo(e.target.value as Condition)}>
            {(Object.keys(labels) as Condition[]).map((c) => <option key={c} value={c}>{labels[c]}</option>)}
          </select>
        </Field>
      </div>
      <Field label={`Quantidade (${it.unit})`} htmlFor="inv-c-q"><input id="inv-c-q" type="number" inputMode="numeric" min={1} value={n} onChange={(e) => setN(e.target.value)} /></Field>
      <Field label="Nota (opcional)" htmlFor="inv-c-n"><input id="inv-c-n" type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Guardar estado</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

function PieceForm({ it, onDone }: { it: ItemDetail; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const [code, setCode] = useState('');
  const [serial, setSerial] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!code.trim()) return setErr('Indica o código da peça.');
    await action.run(() => call('inv_piece_add', { p_section: section, p_item: it.id, p_code: code, p_serial: serial || null, p_notes: null }), 'Peça acrescentada.');
  };
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Acrescentar peça">
      {err && <Notice kind="error">{err}</Notice>}
      <ErrorBox error={action.error} />
      <div className="grid-2">
        <Field label="Código" htmlFor="inv-p-code"><input id="inv-p-code" type="text" maxLength={60} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Número de série (opcional)" htmlFor="inv-p-serial"><input id="inv-p-serial" type="text" maxLength={80} value={serial} onChange={(e) => setSerial(e.target.value)} /></Field>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Acrescentar</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

function PieceRow({ p, manage }: { p: Piece; manage: boolean }) {
  const section = useSectionId();
  const action = useAction();
  const [status, setStatus] = useState<string>(p.status === 'emprestado' ? 'disponivel' : p.status);
  const lent = p.status === 'emprestado';
  return (
    <li className="inv-piece">
      <div className="row between">
        <span><strong>{p.code}</strong>{p.serial && <span className="faint"> · n.º série {p.serial}</span>}</span>
        <Badge label={PIECE_LABEL[p.status]} tone={PIECE_TONE[p.status]} />
      </div>
      {manage && !lent && (
        <div className="row inv-piece-edit">
          <label className="inline-field">
            <span className="sr-only">Estado da peça {p.code}</span>
            <select aria-label={`Estado da peça ${p.code}`} value={status} onChange={(e) => setStatus(e.target.value)}>
              {(['disponivel', 'danificado', 'reparacao', 'retirado'] as const).map((s) => <option key={s} value={s}>{PIECE_LABEL[s]}</option>)}
            </select>
          </label>
          {status !== p.status && (
            <button type="button" className="btn secondary" disabled={action.busy}
              onClick={() => action.run(() => call('inv_piece_update', { p_section: section, p_piece: p.id, p_code: p.code, p_serial: p.serial, p_status: status, p_note: null }), 'Estado da peça atualizado.')}>
              Guardar
            </button>
          )}
        </div>
      )}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
    </li>
  );
}

function ArchiveBox({ it }: { it: ItemDetail }) {
  const section = useSectionId();
  const action = useAction();
  const { isTest } = useModuleCtx();
  const [note, setNote] = useState('');
  const archived = !!it.archived_at;
  return (
    <section className="card danger-zone inv-archive" aria-label="Arquivo">
      <h2 className="label">{archived ? 'Reativar artigo' : 'Retirar do inventário'}</h2>
      <p className="faint prose">
        {archived ? 'O artigo volta à lista de material.' : `Arquivar retira o artigo da lista${isTest ? ' de teste' : ''} sem apagar o histórico. Só é possível sem empréstimos, pedidos ou reservas em curso.`}
      </p>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {!archived && (
        <Field label="Motivo (opcional)" htmlFor="inv-arch-n"><input id="inv-arch-n" type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      )}
      <ConfirmButton className="btn secondary" confirmLabel={archived ? 'Reativar' : 'Arquivar'} disabled={action.busy}
        description={archived ? `Reativar «${it.name}»?` : `Arquivar «${it.name}»? O histórico mantém-se.`}
        onConfirm={() => action.run(() => call('inv_item_archive', { p_section: section, p_item: it.id, p_archived: !archived, p_note: note || null }),
          archived ? 'Artigo reativado.' : 'Artigo arquivado.')}>
        {archived ? 'Reativar' : 'Arquivar artigo'}
      </ConfirmButton>
    </section>
  );
}
