// Sessão: quem conta, registo rápido (seleção explícita: ninguém fica presente por omissão),
// correção individual com justificação e motivo, cancelamento e histórico de correções.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ban, CalendarCheck, CalendarDays, Pencil, RotateCcw } from 'lucide-react';
import { Badge, ErrorBox, Loading, MoreMenu, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatDay } from '../common';
import { CAL_RESPONSE_LABEL, KIND_LABEL, STATUS_LABEL, useSectionId, type Abbr, type CalResponse, type PresStatus, type SessionDetail, type SessionMember } from './api';
import { HistoryList, periodQuery, StatusMark, useParam } from './parts';

type Choice = 'presente' | 'justificada' | 'injustificada' | 'por_registar';
const CHOICES: Choice[] = ['presente', 'justificada', 'injustificada', 'por_registar'];
/** Botões de um toque em cada linha: sigla, estado e significado. */
const QUICK: [Abbr, PresStatus][] = [['P', 'presente'], ['FJ', 'justificada'], ['FI', 'injustificada']];
const QUICK_LABEL: Record<PresStatus, string> = { presente: 'Presente', justificada: 'Falta justificada', injustificada: 'Falta injustificada' };

/** Resposta dada no Calendário (Vou/Não vou): é intenção, não presença. */
function CalAnswer({ r }: { r: CalResponse | null | undefined }) {
  const label = r ? CAL_RESPONSE_LABEL[r] : 'Sem resposta';
  return (
    <span className={`pres-cal pres-cal-${r ?? 'none'}`} title="Resposta no Calendário (não é presença)">
      <CalendarCheck size={13} aria-hidden="true" /> <span className="sr-only">Resposta no </span>Calendário: {label}
    </span>
  );
}

export function SessionPage() {
  const { id = '' } = useParams();
  const section = useSectionId();
  const q = useQuery({
    queryKey: ['pres-session', section, id],
    queryFn: () => call<SessionDetail>('pres_session', { p_section: section, p_session: id }),
  });
  const d = q.data;
  const [cancelOpen, setCancelOpen] = useState(false);
  if (q.isLoading) return <Loading />;
  if (!d) return <><PageTitle title="Sessão" back="/presencas" /><ErrorBox error={q.error} retry={() => q.refetch()} /></>;
  const s = d.session;
  const cancelled = s.effective_status === 'cancelada';
  return (
    <>
      <PageTitle title={s.title} back={`/presencas${periodQuery()}`}
        actions={d.can_register ? (
          <>
            <Link to={`/presencas/sessoes/${s.id}/editar`} className="btn secondary"><Pencil size={15} aria-hidden="true" /> Editar</Link>
            <MoreMenu>
              <button type="button" className="btn" onClick={() => setCancelOpen(true)}>
                {s.status === 'cancelada' ? <><RotateCcw size={15} aria-hidden="true" /> Reativar sessão</> : <><Ban size={15} aria-hidden="true" /> Cancelar sessão</>}
              </button>
            </MoreMenu>
          </>
        ) : undefined} />
      {d.can_register && cancelOpen && <CancelPanel d={d} onClose={() => setCancelOpen(false)} />}
      <section className="card pres-facts">
        <div className="pres-badges">
          <span className="pres-fact-date">{formatDay(s.date)} · {KIND_LABEL[s.kind]}</span>
          {cancelled ? <Badge label="Cancelada" tone="muted" icon="x" /> : s.future ? <Badge label="Sessão futura" tone="progress" icon="clock" /> : <Badge label="Realizada" tone="ok" icon="check" />}
          <Badge label={s.audience === 'equipa' ? `Equipa: ${s.team_name}` : 'Toda a secção'} tone="neutral" />
        </div>
        {s.cal_event && (
          <p className="pres-small"><CalendarDays size={14} aria-hidden="true" /> Ligada à atividade do Calendário «{s.cal_event.title}»
            ({formatDay(s.cal_event.start)}{s.cal_event.end !== s.cal_event.start ? ` a ${formatDay(s.cal_event.end)}` : ''})
            {s.cal_event.status === 'cancelado' && ' — cancelada no Calendário'}</p>
        )}
        {s.cal_event && d.can_register && (
          <p className="faint pres-small" data-testid="nota-calendario">«Vou/Não vou» é a resposta no Calendário: não é presença nem falta.</p>
        )}
        {s.status === 'cancelada' && <p className="pres-small">Cancelada{s.cancel_reason ? `: ${s.cancel_reason}` : '.'} Não conta para a assiduidade.</p>}
        {s.notes && <p className="prose pres-small">{s.notes}</p>}
        {s.future && !cancelled && <p className="faint pres-small">A sessão ainda não aconteceu: só é possível registar faltas justificadas antecipadas, que só contam depois da data.</p>}
      </section>
      {d.can_register ? <Register d={d} onDone={() => q.refetch()} /> : <OwnRecord d={d} />}
      {d.can_register && (
        <details className="card flat pres-details">
          <summary>Histórico de correções ({d.history.length})</summary>
          <HistoryList rows={d.history} showName />
        </details>
      )}
    </>
  );
}

function OwnRecord({ d }: { d: SessionDetail }) {
  const me = d.members[0];
  if (!me) return null;
  return (
    <section className="card">
      <h2 className="pres-h2">O teu registo</h2>
      <p className="pres-member-meta"><StatusMark category={me.category} partial={me.partial} />{d.session.cal_event && <CalAnswer r={me.cal_response} />}</p>
      {me.partial_note && <p className="pres-small">Parcial: {me.partial_note}</p>}
      {me.justification && <p className="pres-small pres-just">Justificação: {me.justification}</p>}
    </section>
  );
}

/** Cancelar ou reativar a sessão (aberto a partir de «Mais»). */
function CancelPanel({ d, onClose }: { d: SessionDetail; onClose: () => void }) {
  const section = useSectionId();
  const a = useAction();
  const [reason, setReason] = useState('');
  const s = d.session;
  const cancel = s.status === 'ativa';
  return (
    <section className="card pres-cancel" aria-label={cancel ? 'Cancelar sessão' : 'Reativar sessão'}>
      <h2 className="pres-h2">{cancel ? 'Cancelar sessão' : 'Reativar sessão'}</h2>
      <p className="faint pres-small">
        {cancel ? 'Uma sessão cancelada não conta para a assiduidade. Os registos não se apagam.' : 'A sessão volta a contar para a assiduidade.'}
      </p>
      {cancel && (
        <label className="field">
          <span className="label">Motivo (opcional)</span>
          <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <div className="btn-row">
        <button type="button" className={`btn${cancel ? ' secondary danger' : ''}`} disabled={a.busy} aria-busy={a.busy}
          onClick={async () => {
            const r = await a.run(() => call('pres_session_cancel', { p_section: section, p_session: s.id, p_cancel: cancel, p_reason: reason || null }),
              cancel ? 'Sessão cancelada.' : 'Sessão reativada.');
            if (r.ok) onClose();
          }}>
          {cancel ? 'Confirmar cancelamento' : 'Reativar'}
        </button>
        <button type="button" className="btn secondary" onClick={onClose}>Fechar</button>
      </div>
      {a.error && <Notice kind="error">{a.error}</Notice>}
    </section>
  );
}

function Register({ d, onDone }: { d: SessionDetail; onDone: () => void }) {
  const section = useSectionId();
  const a = useAction();
  const [focus] = useParam('pessoa');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Choice | ''>('');
  const [partial, setPartial] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState<string | null>(focus || null);
  const cancelled = d.session.effective_status === 'cancelada';
  const future = d.session.future;
  const quickAction = useAction();
  const [quickBusy, setQuickBusy] = useState<string | null>(null);
  const pending = useMemo(() => d.members.filter((m) => m.status === null).map((m) => m.membership_id), [d.members]);
  const saidYes = useMemo(() => d.members.filter((m) => m.status === null && m.cal_response === 'vou').map((m) => m.membership_id), [d.members]);
  const linked = !!d.session.cal_event;
  const anyRecorded = d.members.some((m) => selected.has(m.membership_id) && m.status !== null);
  const allowed = (c: Choice) => !future || c === 'justificada' || c === 'por_registar';

  useEffect(() => { if (status !== 'presente') setPartial(false); }, [status]);
  useEffect(() => {
    if (focus) document.getElementById(`pres-m-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus]);

  if (d.members.length === 0) {
    return (
      <section className="card">
        <h2 className="pres-h2">Presenças</h2>
        <p className="faint prose">Ninguém conta nesta sessão: não havia pioneiros nem guias ativos {d.session.audience === 'equipa' ? 'nesta equipa' : 'na secção'} nesta data.</p>
      </section>
    );
  }

  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const apply = async () => {
    if (!status) return;
    const r = await a.run(() => call<number>('pres_record', {
      p_section: section, p_session: d.session.id, p_memberships: [...selected], p_status: status,
      p_partial: partial, p_partial_note: partial ? note || null : null, p_justification: null, p_reason: reason || null,
    }), `Registado para ${selected.size} ${selected.size === 1 ? 'pessoa' : 'pessoas'}.`);
    if (r.ok) { setSelected(new Set()); setStatus(''); setPartial(false); setNote(''); setReason(''); onDone(); }
  };
  const quick = async (m: SessionMember, c: PresStatus) => {
    if (m.status === c && !m.partial) return;
    setQuickBusy(m.membership_id);
    await quickAction.run(() => call<number>('pres_record', {
      p_section: section, p_session: d.session.id, p_memberships: [m.membership_id], p_status: c,
      p_partial: false, p_partial_note: null, p_justification: null, p_reason: null,
    }), `${m.name}: ${STATUS_LABEL[c]}.`);
    setQuickBusy(null);
    onDone();
  };
  const counts = CHOICES.map((c) => [c, d.members.filter((m) => (m.status ?? 'por_registar') === c).length] as const);

  return (
    <section className="card">
      <div className="pres-reg-head">
        <h2 className="pres-h2">Presenças ({d.members.length} {d.members.length === 1 ? 'pessoa conta' : 'pessoas contam'})</h2>
        <p className="faint pres-small">{counts.map(([c, n]) => `${STATUS_LABEL[c]}: ${n}`).join(' · ')}</p>
      </div>
      {!cancelled && (
        <div className="pres-select-row">
          <button type="button" className="btn ghost" onClick={() => setSelected(new Set(pending))} disabled={pending.length === 0}>
            Selecionar os por registar ({pending.length})
          </button>
          {linked && (
            <button type="button" className="btn ghost" onClick={() => setSelected(new Set(saidYes))} disabled={saidYes.length === 0}>
              Selecionar quem disse «Vou» ({saidYes.length})
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Limpar seleção</button>
        </div>
      )}
      {!cancelled && (
        <p className="faint pres-small pres-quick-help" data-testid="legenda-botoes">
          Um toque por pessoa: {QUICK.filter(([, c]) => allowed(c)).map(([k, c]) => <span key={k}><strong>{k}</strong> {QUICK_LABEL[c].toLowerCase()} </span>)}
          · <Pencil size={12} aria-hidden="true" /> corrigir: parcial, justificação ou desfazer.
        </p>
      )}
      {quickAction.error && <Notice kind="error">{quickAction.error}</Notice>}
      <p className="sr-only" role="status">{quickAction.success}</p>
      <ul className="list pres-members" aria-label="Pessoas da sessão">
        {d.members.map((m) => (
          <li key={m.membership_id} id={`pres-m-${m.membership_id}`} className={`pres-member${focus === m.membership_id ? ' focus' : ''}`}>
            <div className="pres-member-row">
              {!cancelled && (
                <input type="checkbox" id={`sel-${m.membership_id}`} checked={selected.has(m.membership_id)} onChange={() => toggle(m.membership_id)} />
              )}
              <label htmlFor={`sel-${m.membership_id}`} className="grow pres-member-name">
                <span className="pres-row-title">{m.name}</span>
                <span className="pres-member-meta">
                  <StatusMark category={m.category === 'cancelada' || m.category === 'futura' ? (m.status ?? 'por_registar') : m.category} partial={m.partial} />
                  <span className="faint pres-small">{m.team_name ?? 'Sem equipa'}{m.partial_note ? ` · parcial: ${m.partial_note}` : ''}{m.justification ? ' · com justificação' : ''}</span>
                  {linked && m.cal_response && <CalAnswer r={m.cal_response} />}
                </span>
              </label>
              {!cancelled && (
                <span className="pres-quick-btns" role="group" aria-label={`Registar ${m.name}`}>
                  {QUICK.map(([k, c]) => {
                    const on = m.status === c;
                    return (
                      <button key={k} type="button" className={`pres-qbtn pres-${c}${on ? ' on' : ''}`} aria-pressed={on}
                        title={`${QUICK_LABEL[c]}${on ? ' (registado)' : ''}`} aria-label={`${m.name}: ${QUICK_LABEL[c]}`}
                        disabled={!allowed(c) || quickBusy !== null || a.busy} aria-busy={quickBusy === m.membership_id || undefined}
                        onClick={() => void quick(m, c)}>
                        {k}
                      </button>
                    );
                  })}
                </span>
              )}
              {!cancelled && (
                <button type="button" className="btn ghost pres-icon-btn" aria-label={`Corrigir ${m.name}`} aria-expanded={editing === m.membership_id}
                  onClick={() => setEditing(editing === m.membership_id ? null : m.membership_id)}>
                  <Pencil size={15} aria-hidden="true" />
                </button>
              )}
            </div>
            {editing === m.membership_id && !cancelled && (
              <EditOne m={m} future={future} sessionId={d.session.id} onDone={() => { setEditing(null); onDone(); }} />
            )}
          </li>
        ))}
      </ul>
      {cancelled ? (
        <Notice kind="info">Esta sessão está cancelada: não é possível registar presenças.</Notice>
      ) : (
        <fieldset className="pres-quick">
          <legend>Vários de uma vez</legend>
          <p className="faint pres-small">Marca as pessoas na lista e escolhe o estado. Ninguém é marcado por omissão.</p>
          <div className="pres-choices" role="radiogroup" aria-label="Estado a registar">
            {CHOICES.map((c) => (
              <label key={c} className={`pres-choice pres-${c}${status === c ? ' on' : ''}${allowed(c) ? '' : ' disabled'}`}>
                <input type="radio" name="pres-status" value={c} checked={status === c} disabled={!allowed(c)} onChange={() => setStatus(c)} />
                <StatusMark category={c} />
              </label>
            ))}
          </div>
          {status === 'presente' && (
            <div className="pres-partial-box">
              <label className="pres-check"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Participação parcial</label>
              {partial && (
                <label className="field">
                  <span className="label">Nota curta (opcional)</span>
                  <input value={note} maxLength={200} placeholder="Ex.: chegou às 16h" onChange={(e) => setNote(e.target.value)} />
                </label>
              )}
            </div>
          )}
          {anyRecorded && (
            <label className="field">
              <span className="label">Motivo da correção (opcional)</span>
              <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          <button type="button" className="btn" disabled={a.busy || selected.size === 0 || !status} aria-busy={a.busy} onClick={apply}>
            {selected.size === 0 ? 'Seleciona pessoas' : !status ? 'Escolhe o estado' : `Aplicar a ${selected.size} ${selected.size === 1 ? 'pessoa' : 'pessoas'}`}
          </button>
        </fieldset>
      )}
      {a.error && <Notice kind="error">{a.error}</Notice>}
      {a.success && <Notice kind="success">{a.success}</Notice>}
    </section>
  );
}

/** Correção individual: estado, parcial, justificação (restrita) e motivo. */
function EditOne({ m, future, sessionId, onDone }: { m: SessionMember; future: boolean; sessionId: string; onDone: () => void }) {
  const section = useSectionId();
  const a = useAction();
  const [status, setStatus] = useState<Choice>(m.status ?? 'por_registar');
  const [partial, setPartial] = useState(m.partial);
  const [note, setNote] = useState(m.partial_note ?? '');
  const [just, setJust] = useState(m.justification ?? '');
  const [reason, setReason] = useState('');
  const isAbsence = status === 'justificada' || status === 'injustificada';
  const save = async () => {
    const r = await a.run(() => call('pres_record', {
      p_section: section, p_session: sessionId, p_memberships: [m.membership_id], p_status: status,
      p_partial: status === 'presente' && partial, p_partial_note: status === 'presente' && partial ? note || null : null,
      p_justification: isAbsence ? just : null, p_reason: reason || null,
    }), 'Registo guardado.');
    if (r.ok) onDone();
  };
  return (
    <form className="pres-edit" onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={`Corrigir registo de ${m.name}`}>
      <label className="field">
        <span className="label">Estado</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as Choice)}>
          {CHOICES.map((c) => <option key={c} value={c} disabled={future && c !== 'justificada' && c !== 'por_registar'}>{STATUS_LABEL[c]}</option>)}
        </select>
      </label>
      {status === 'presente' && (
        <>
          <label className="pres-check"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Participação parcial</label>
          {partial && (
            <label className="field"><span className="label">Nota curta (opcional)</span>
              <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
          )}
        </>
      )}
      {isAbsence && (
        <label className="field">
          <span className="label">Justificação (opcional)</span>
          <span className="hint prose">Só é visível para quem regista presenças e para o próprio.</span>
          <textarea rows={2} maxLength={500} value={just} onChange={(e) => setJust(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span className="label">Motivo da correção (opcional)</span>
        <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="btn-row">
        <button type="submit" className="btn" disabled={a.busy} aria-busy={a.busy}>Guardar</button>
        <button type="button" className="btn secondary" onClick={onDone}>Fechar</button>
      </div>
      {a.error && <Notice kind="error">{a.error}</Notice>}
    </form>
  );
}
