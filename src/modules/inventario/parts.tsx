// Inventário: peças de interface partilhadas (separadores, estados, cartões de
// empréstimo e formulários de empréstimo, devolução e reserva).
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Layers, Package, ShoppingCart } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Badge, ConfirmButton, ErrorBox, Field, Notice } from '../../components/ui';
import { isoToLisbon, lisbonToIso } from '../common';
import {
  CONDITION_LABEL, LOAN_LABEL, STATE_LABEL, STATE_TONE, eventChoices, qty, useEventOptions, useOverview, usePeople, useSectionId, when,
  type Condition, type ItemState, type Loan, type Piece, type Reservation, type Stock,
} from './api';
import { DateTimeInput } from '../../components/DateInput';
import { EventSelect } from '../EventSelect';

/** Três entradas principais: Material, Empréstimos (com as reservas) e A comprar. Os alertas
 *  chegam-se pelos indicadores do resumo; os tipos ficam no menu de configuração. */
export function InvTabs() {
  const ov = useOverview();
  const manage = ov.data?.can_manage;
  const tab = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' active' : ''}`;
  return (
    <nav className="tabs inv-tabs" aria-label="Inventário">
      <NavLink end to="/inventario" className={tab}><Package size={16} aria-hidden="true" /> Material</NavLink>
      <NavLink to="/inventario/emprestimos" className={tab}>
        <Layers size={16} aria-hidden="true" /> Empréstimos
        {!!ov.data?.pending_requests && manage && <span className="nav-count" aria-label={`${ov.data.pending_requests} pedidos por decidir`}>{ov.data.pending_requests}</span>}
      </NavLink>
      <NavLink to="/inventario/comprar" className={tab}>
        <ShoppingCart size={16} aria-hidden="true" /> A comprar
        {!!ov.data?.summary?.purchases_pending && <span className="nav-count" aria-label={`${ov.data.summary.purchases_pending} compras pendentes`}>{ov.data.summary.purchases_pending}</span>}
      </NavLink>
    </nav>
  );
}

export function StateBadges({ states }: { states: ItemState[] }) {
  if (!states.length) return <Badge label="Sem unidades" tone="muted" />;
  return <>{states.map((s) => <Badge key={s} label={STATE_LABEL[s]} tone={STATE_TONE[s]} />)}</>;
}

/** «3 de 6 un. disponíveis» */
export function availabilityText(s: Stock, unit: string) {
  return `${s.available} de ${qty(s.total, unit)} ${s.available === 1 ? 'disponível' : 'disponíveis'}`;
}

/** Valor para um campo datetime-local, em hora de Lisboa, daqui a h horas (minutos arredondados aos 5). */
export function localIn(hours: number) {
  const t = Date.now() + hours * 3600e3;
  return isoToLisbon(new Date(Math.ceil(t / 300e3) * 300e3).toISOString());
}
const toIso = (local: string) => { try { return lisbonToIso(local); } catch { return null; } };

/** Ação de formulário: em caso de sucesso, fecha o formulário e passa a mensagem a quem o abriu. */
export function useFormAction(onDone: (msg?: string) => void) {
  const a = useAction();
  const base = a.run;
  const run = useCallback(async <T,>(fn: () => Promise<T>, msg?: string) => {
    const r = await base(fn, msg);
    if (r.ok) onDone(msg);
    return r;
  }, [base, onDone]);
  return { ...a, run };
}

function useFormError() {
  const [err, setErr] = useState<string | null>(null);
  return { err, setErr, box: err ? <Notice kind="error">{err}</Notice> : null };
}

// ---------------------------------------------------------------------------
// Cartão de empréstimo (com ações conforme quem vê)
// ---------------------------------------------------------------------------
export function LoanCard({ l, canManage, me, showItem = true }: { l: Loan; canManage: boolean; me: string; showItem?: boolean }) {
  const [open, setOpen] = useState<'devolver' | 'prazo' | 'decidir' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const done = (msg?: string) => { setOpen(null); setFlash(msg ?? null); };
  const action = useAction();
  const section = useSectionId();
  const st = LOAN_LABEL[l.status];
  const outstanding = l.quantity - l.returned_qty;
  return (
    <li className={`card inv-loan${l.overdue ? ' inv-overdue' : ''}`}>
      <div className="row between inv-loan-head">
        <div className="inv-loan-title">
          {showItem ? <Link to={`/inventario/artigo/${l.item_id}`}><strong>{l.item}</strong></Link> : <strong>{qty(l.quantity, l.unit)}</strong>}
          <span className="faint">{showItem && `${qty(l.quantity, l.unit)} · `}{l.borrower}</span>
        </div>
        <div className="row inv-badges">
          {l.overdue ? <Badge label="Devolução em atraso" tone="attention" icon="clock" /> : <Badge label={st.label} tone={st.tone} />}
        </div>
      </div>
      <dl className="inv-dl">
        <div><dt>Saída</dt><dd>{when(l.out_at)}</dd></div>
        <div><dt>Devolver até</dt><dd>{when(l.due_at)}</dd></div>
        {l.status === 'ativo' && l.returned_qty > 0 && <div><dt>Devolvido</dt><dd>{l.returned_qty} de {qty(l.quantity, l.unit)}</dd></div>}
        {l.returned_at && <div><dt>Devolvido em</dt><dd>{when(l.returned_at)}</dd></div>}
        {l.registered_by && <div><dt>Saída registada por</dt><dd>{l.registered_by}</dd></div>}
      </dl>
      {l.returns.length > 0 && (
        <ul className="inv-returns" aria-label="Devoluções">
          {l.returns.map((r, k) => (
            <li key={k} className="faint">
              {when(r.at)} · devolvido {qty(r.quantity, l.unit)} · chegou {CONDITION_ARRIVAL[r.condition] ?? r.condition}{r.by ? ` · registado por ${r.by}` : ''}
            </li>
          ))}
        </ul>
      )}
      {l.pieces.length > 0 && (
        <p className="faint inv-pieces-line">Peças: {l.pieces.map((p) => `${p.code}${p.returned_at ? ' (devolvida)' : ''}`).join(', ')}</p>
      )}
      {l.notes && <p className="faint prose">{l.notes}</p>}
      {l.decision_note && <p className="faint prose">Nota da decisão: {l.decision_note}</p>}
      <ErrorBox error={action.error} />
      {(action.success || flash) && <Notice kind="success">{action.success ?? flash}</Notice>}
      <div className="btn-row">
        {canManage && l.status === 'pedido' && (
          <button type="button" className="btn" onClick={() => { setFlash(null); setOpen(open === 'decidir' ? null : 'decidir'); }}>Decidir pedido</button>
        )}
        {canManage && l.status === 'ativo' && outstanding > 0 && (
          <>
            <button type="button" className="btn" onClick={() => { setFlash(null); setOpen(open === 'devolver' ? null : 'devolver'); }}>Registar devolução</button>
            <button type="button" className="btn secondary" onClick={() => { setFlash(null); setOpen(open === 'prazo' ? null : 'prazo'); }}>Alterar prazo</button>
          </>
        )}
        {l.status === 'pedido' && (canManage || l.borrower_id === me) && (
          <ConfirmButton className="btn ghost" confirmLabel="Cancelar pedido" disabled={action.busy} description="O pedido deixa de estar por decidir."
            onConfirm={() => action.run(() => call('inv_loan_cancel', { p_section: section, p_loan: l.id, p_note: null }), 'Pedido cancelado.')}>
            Cancelar pedido
          </ConfirmButton>
        )}
      </div>
      {open === 'devolver' && <ReturnForm l={l} onDone={done} />}
      {open === 'prazo' && <ExtendForm l={l} onDone={done} />}
      {open === 'decidir' && <DecideForm l={l} onDone={done} />}
    </li>
  );
}

const CONDITION_ARRIVAL: Record<string, string> = { disponivel: 'em bom estado', danificado: 'danificado', reparacao: 'a precisar de reparação' };

function ReturnForm({ l, onDone }: { l: Loan; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const outstanding = l.quantity - l.returned_qty;
  const open = l.pieces.filter((p) => !p.returned_at);
  const [n, setN] = useState(String(outstanding));
  const [pieces, setPieces] = useState<string[]>(open.map((p) => p.id));
  const [cond, setCond] = useState<Condition>('disponivel');
  const [note, setNote] = useState('');
  const f = useFormError();
  const byPieces = l.tracking === 'pecas';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    f.setErr(null);
    const q = Number(n);
    if (byPieces && pieces.length === 0) return f.setErr('Escolhe as peças devolvidas.');
    if (!byPieces && (!Number.isInteger(q) || q < 1 || q > outstanding)) return f.setErr(`Indica uma quantidade entre 1 e ${outstanding}.`);
    await action.run(() => call('inv_loan_return', {
      p_section: section, p_loan: l.id, p_quantity: byPieces ? null : q, p_pieces: byPieces ? pieces : null, p_condition: cond, p_note: note || null,
    }), 'Devolução registada.');
  };
  const id = `ret-${l.id}`;
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Registar devolução">
      {f.box}
      <ErrorBox error={action.error} />
      {byPieces ? (
        <fieldset className="inv-checks">
          <legend className="label">Peças devolvidas</legend>
          {open.map((p) => (
            <label key={p.id} className="checkbox">
              <input type="checkbox" checked={pieces.includes(p.id)}
                onChange={(e) => setPieces(e.target.checked ? [...pieces, p.id] : pieces.filter((x) => x !== p.id))} />
              {p.code}{p.serial ? ` · ${p.serial}` : ''}
            </label>
          ))}
        </fieldset>
      ) : (
        <Field label={`Quantidade devolvida (faltam ${qty(outstanding, l.unit)})`} htmlFor={`${id}-q`}>
          <input id={`${id}-q`} type="number" inputMode="numeric" min={1} max={outstanding} value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
      )}
      <Field label="Estado em que volta" htmlFor={`${id}-c`}>
        <select id={`${id}-c`} value={cond} onChange={(e) => setCond(e.target.value as Condition)}>
          {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
        </select>
      </Field>
      <Field label="Nota (opcional)" htmlFor={`${id}-n`}>
        <input id={`${id}-n`} type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Confirmar devolução</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

function ExtendForm({ l, onDone }: { l: Loan; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const [due, setDue] = useState(isoToLisbon(l.due_at));
  const [note, setNote] = useState('');
  const f = useFormError();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const iso = toIso(due);
    if (!iso || new Date(iso).getTime() <= Date.now()) return f.setErr('Indica um novo prazo no futuro.');
    await action.run(() => call('inv_loan_extend', { p_section: section, p_loan: l.id, p_due_at: iso, p_note: note || null }), 'Prazo alterado.');
  };
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Alterar prazo">
      {f.box}
      <ErrorBox error={action.error} />
      <Field label="Novo prazo de devolução" htmlFor={`due-${l.id}`}>
        <DateTimeInput timeLabel="Hora do novo prazo" id={`due-${l.id}`} value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      <Field label="Motivo (opcional)" htmlFor={`duen-${l.id}`}>
        <input id={`duen-${l.id}`} type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Guardar prazo</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

function DecideForm({ l, onDone }: { l: Loan; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const [note, setNote] = useState('');
  const f = useFormError();
  const decide = async (approve: boolean) => {
    f.setErr(null);
    if (!approve && !note.trim()) return f.setErr('Indica o motivo da recusa.');
    await action.run(() => call('inv_loan_decide', { p_section: section, p_loan: l.id, p_approve: approve, p_note: note || null, p_pieces: null }),
      approve ? 'Pedido aprovado: o material fica emprestado.' : 'Pedido recusado.');
  };
  return (
    <div className="inv-form card flat" role="group" aria-label="Decidir pedido">
      {f.box}
      <ErrorBox error={action.error} />
      <p className="faint prose">Ao aprovar, o servidor confirma se o material ainda está livre no período pedido.{l.tracking === 'pecas' ? ' As peças são escolhidas automaticamente entre as disponíveis.' : ''}</p>
      <Field label="Nota para quem pediu (obrigatória para recusar)" htmlFor={`dec-${l.id}`}>
        <input id={`dec-${l.id}`} type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button type="button" className="btn" disabled={action.busy} onClick={() => decide(true)}>Aprovar</button>
        <button type="button" className="btn secondary" disabled={action.busy} onClick={() => decide(false)}>Recusar</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empréstimo (quem gere) ou pedido de empréstimo (restantes)
// ---------------------------------------------------------------------------
export function LoanForm({ item, mode, reservation, onDone }: {
  item: { id: string; name: string; unit: string; tracking: 'quantidade' | 'pecas'; pieces?: Piece[] };
  mode: 'emprestar' | 'pedir'; reservation?: Reservation; onDone: (msg?: string) => void;
}) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const people = usePeople(mode === 'emprestar');
  const [borrower, setBorrower] = useState('');
  const [n, setN] = useState(String(reservation?.quantity ?? 1));
  const [pieces, setPieces] = useState<string[]>([]);
  const [out, setOut] = useState(() => (reservation && new Date(reservation.starts_at).getTime() > Date.now() ? isoToLisbon(reservation.starts_at) : localIn(0)));
  const [due, setDue] = useState(() => (reservation ? isoToLisbon(reservation.ends_at) : localIn(24)));
  const [remind, setRemind] = useState('24');
  const [notes, setNotes] = useState('');
  const [free, setFree] = useState<number | null>(null);
  const f = useFormError();
  const freePieces = (item.pieces ?? []).filter((p) => p.status === 'disponivel');
  const choosePieces = mode === 'emprestar' && item.tracking === 'pecas' && !!item.pieces;
  const outIso = toIso(out);
  const dueIso = toIso(due);

  useEffect(() => {
    setFree(null);
    if (!outIso || !dueIso || dueIso <= outIso || reservation) return;
    let alive = true;
    const t = window.setTimeout(() => {
      call<number>('inv_availability', { p_section: section, p_item: item.id, p_from: outIso, p_to: dueIso })
        .then((v) => { if (alive) setFree(v); }).catch(() => undefined);
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [outIso, dueIso, item.id, section, reservation]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    f.setErr(null);
    const q = choosePieces ? pieces.length : Number(n);
    if (mode === 'emprestar' && !borrower) return f.setErr('Escolhe o responsável pelo material.');
    if (choosePieces && q === 0) return f.setErr('Escolhe as peças a emprestar.');
    if (!Number.isInteger(q) || q < 1) return f.setErr('Indica uma quantidade igual ou superior a 1.');
    if (!outIso) return f.setErr('Indica a data de saída.');
    if (!dueIso) return f.setErr('Indica a data prevista de devolução.');
    if (new Date(dueIso) <= new Date(outIso)) return f.setErr('A devolução tem de ser depois da saída.');
    if (new Date(dueIso).getTime() <= Date.now()) return f.setErr('A data prevista de devolução já passou.');
    mode === 'emprestar'
      ? await action.run(() => call('inv_loan_create', {
          p_section: section, p_item: item.id, p_borrower: borrower, p_quantity: q, p_out_at: outIso, p_due_at: dueIso,
          p_pieces: choosePieces ? pieces : null, p_reservation: reservation?.id ?? null, p_notes: notes || null, p_remind_hours: Number(remind),
        }), 'Empréstimo registado.')
      : await action.run(() => call('inv_loan_request', {
          p_section: section, p_item: item.id, p_quantity: q, p_out_at: outIso, p_due_at: dueIso, p_notes: notes || null,
        }), 'Pedido enviado. Vais receber uma notificação quando for decidido.');
  };
  const id = `loan-${item.id}`;
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label={mode === 'emprestar' ? 'Emprestar material' : 'Pedir empréstimo'}>
      <h3 className="label">{mode === 'emprestar' ? `Emprestar «${item.name}»` : `Pedir «${item.name}» emprestado`}</h3>
      {mode === 'pedir' && <p className="faint prose">O pedido fica a aguardar aprovação de um responsável pelo material.</p>}
      {f.box}
      <ErrorBox error={action.error} />
      {mode === 'emprestar' && (
        <Field label="Responsável" htmlFor={`${id}-b`}>
          <select id={`${id}-b`} value={borrower} onChange={(e) => setBorrower(e.target.value)}>
            <option value="">Escolhe um membro…</option>
            {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {choosePieces ? (
        <fieldset className="inv-checks">
          <legend className="label">Peças</legend>
          {freePieces.length === 0 && <p className="faint">Não há peças disponíveis.</p>}
          {freePieces.map((p) => (
            <label key={p.id} className="checkbox">
              <input type="checkbox" checked={pieces.includes(p.id)}
                onChange={(e) => setPieces(e.target.checked ? [...pieces, p.id] : pieces.filter((x) => x !== p.id))} />
              {p.code}{p.serial ? ` · ${p.serial}` : ''}
            </label>
          ))}
        </fieldset>
      ) : (
        <Field label={`Quantidade (${item.unit})`} htmlFor={`${id}-q`}>
          <input id={`${id}-q`} type="number" inputMode="numeric" min={1} value={n} onChange={(e) => setN(e.target.value)} />
        </Field>
      )}
      <div className="grid-2">
        <Field label="Saída" htmlFor={`${id}-o`}>
          <DateTimeInput timeLabel="Hora da saída" id={`${id}-o`} value={out} onChange={(e) => setOut(e.target.value)} />
        </Field>
        <Field label="Devolução prevista" htmlFor={`${id}-d`}>
          <DateTimeInput timeLabel="Hora da devolução prevista" id={`${id}-d`} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      {free != null && <p className="faint" aria-live="polite">Livres nesse período: {qty(free, item.unit)}</p>}
      {mode === 'emprestar' && (
        <Field label="Lembrete antes do prazo" htmlFor={`${id}-r`}>
          <select id={`${id}-r`} value={remind} onChange={(e) => setRemind(e.target.value)}>
            <option value="0">Só no prazo</option>
            <option value="24">1 dia antes e no prazo</option>
            <option value="48">2 dias antes e no prazo</option>
            <option value="168">1 semana antes e no prazo</option>
          </select>
        </Field>
      )}
      <Field label="Notas (opcional)" htmlFor={`${id}-n`}>
        <input id={`${id}-n`} type="text" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>{mode === 'emprestar' ? 'Registar empréstimo' : 'Enviar pedido'}</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Reserva ligada (ou não) a uma atividade do calendário
// ---------------------------------------------------------------------------
export function ReservationForm({ item, onDone }: { item: { id: string; name: string; unit: string }; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useFormAction(onDone);
  const events = useEventOptions();
  const [event, setEvent] = useState('');
  const [inherit, setInherit] = useState(true);
  const [n, setN] = useState('1');
  const [from, setFrom] = useState(localIn(24));
  const [to, setTo] = useState(localIn(48));
  const [notes, setNotes] = useState('');
  const f = useFormError();
  const ev = events.data?.find((e) => e.id === event);
  const useEvent = !!ev && inherit;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    f.setErr(null);
    const q = Number(n);
    if (!Number.isInteger(q) || q < 1) return f.setErr('Indica uma quantidade igual ou superior a 1.');
    const s = useEvent ? null : toIso(from);
    const t = useEvent ? null : toIso(to);
    if (!useEvent && (!s || !t)) return f.setErr('Indica o início e o fim da reserva.');
    if (!useEvent && new Date(t!) <= new Date(s!)) return f.setErr('O fim da reserva tem de ser depois do início.');
    await action.run(() => call('inv_reservation_create', {
      p_section: section, p_item: item.id, p_event: event || null, p_quantity: q, p_starts_at: s, p_ends_at: t, p_notes: notes || null,
    }), 'Reserva registada.');
  };
  const id = `res-${item.id}`;
  return (
    <form className="inv-form card flat" onSubmit={submit} noValidate aria-label="Reservar material">
      <h3 className="label">Reservar «{item.name}»</h3>
      {f.box}
      <ErrorBox error={action.error} />
      <Field label="Atividade do calendário" htmlFor={`${id}-e`} hint={events.data && events.data.length === 0 ? 'Não há atividades futuras no calendário: indica o período à mão.' : undefined}>
        <EventSelect id={`${id}-e`} value={event} onChange={setEvent} events={eventChoices(events.data ?? [])} empty="Sem atividade" loading={events.isLoading} />
      </Field>
      {ev && (
        <label className="checkbox">
          <input type="checkbox" checked={inherit} onChange={(e) => {
            setInherit(e.target.checked);
            if (!e.target.checked) { setFrom(isoToLisbon(ev.starts_at)); setTo(isoToLisbon(ev.ends_at)); }
          }} />
          Usar o período da atividade ({when(ev.starts_at)} – {when(ev.ends_at)})
        </label>
      )}
      {!useEvent && (
        <div className="grid-2">
          <Field label="Início" htmlFor={`${id}-s`}><DateTimeInput timeLabel="Hora de início" id={`${id}-s`} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Fim" htmlFor={`${id}-t`}><DateTimeInput timeLabel="Hora de fim" id={`${id}-t`} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      )}
      <Field label={`Quantidade (${item.unit})`} htmlFor={`${id}-q`}>
        <input id={`${id}-q`} type="number" inputMode="numeric" min={1} value={n} onChange={(e) => setN(e.target.value)} />
      </Field>
      <Field label="Notas (opcional)" htmlFor={`${id}-n`}>
        <input id={`${id}-n`} type="text" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>Reservar</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

export function ReservationCard({ r, canManage, showItem = true }: { r: Reservation; canManage: boolean; showItem?: boolean }) {
  const section = useSectionId();
  const action = useAction();
  const [lift, setLift] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const active = r.status === 'ativa';
  return (
    <li className="card inv-loan inv-res">
      <div className="row between inv-loan-head">
        <div className="inv-loan-title">
          {showItem ? <Link to={`/inventario/artigo/${r.item_id}`}><strong>{r.item}</strong></Link> : <strong>{qty(r.quantity, r.unit)}</strong>}
          <span className="faint">{showItem && `${qty(r.quantity, r.unit)} · `}{r.event ?? 'Sem atividade'}{r.event_cancelled ? ' (atividade cancelada)' : ''}</span>
        </div>
        <div className="row inv-badges">
          {r.at_risk && <Badge label="Sem material suficiente" tone="attention" />}
          <Badge label={active ? 'Reservado' : r.status === 'concluida' ? 'Levantada' : 'Cancelada'} tone={active ? 'neutral' : 'muted'} />
        </div>
      </div>
      <dl className="inv-dl">
        <div><dt>De</dt><dd>{when(r.starts_at)}</dd></div>
        <div><dt>Até</dt><dd>{when(r.ends_at)}</dd></div>
      </dl>
      {r.notes && <p className="faint prose">{r.notes}</p>}
      <ErrorBox error={action.error} />
      {(action.success || flash) && <Notice kind="success">{action.success ?? flash}</Notice>}
      {canManage && active && (
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={() => setLift(!lift)}>Levantar (emprestar)</button>
          <ConfirmButton className="btn ghost" confirmLabel="Cancelar reserva" disabled={action.busy} description="O material deixa de estar reservado para este período."
            onConfirm={() => action.run(() => call('inv_reservation_cancel', { p_section: section, p_reservation: r.id, p_note: null }), 'Reserva cancelada.')}>
            Cancelar reserva
          </ConfirmButton>
        </div>
      )}
      {lift && <LoanForm item={{ id: r.item_id, name: r.item, unit: r.unit, tracking: 'quantidade' }} mode="emprestar" reservation={r} onDone={(m) => { setLift(false); setFlash(m ?? null); }} />}
    </li>
  );
}

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="inv-section" aria-label={title}>
      <h2 className="section-title">{title}{count != null && <span className="faint"> · {count}</span>}</h2>
      {children}
    </section>
  );
}
