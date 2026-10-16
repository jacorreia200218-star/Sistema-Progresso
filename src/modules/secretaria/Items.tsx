// Registos da ata: decisões, tarefas e preparativos («a preparar para a próxima atividade»).
// Alteram-se só com o documento em rascunho; o estado de execução gere-se no quadro.
// O que não consta da ata (responsável, prazo, atividade) fica «Por definir».
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Link2, Plus, User } from 'lucide-react';
import { Badge, ErrorBox, Field, Notice } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useActiveSection } from '../../lib/session';
import { formatDay } from '../common';
import {
  BASE, BOARD_STATUSES, EXEC_STATUS, ITEM_KIND, UNDEFINED, useEventOptions, usePeople, useSectionId,
  type EventRef, type ExecStatus, type Item, type ItemKind,
} from './api';
import { DateInput } from '../../components/DateInput';

/** Muda o estado (Por fazer, Em curso, Concluída). O servidor confirma quem pode. */
export function ItemStatusControl({ item, disabled, onChanged }: {
  item: { id: string; text: string; exec_status: ExecStatus }; disabled?: boolean; onChanged?: (msg: string) => void;
}) {
  const section = useSectionId();
  const action = useAction();
  if (item.exec_status === 'cancelada') return <Badge {...EXEC_STATUS.cancelada} />;
  return (
    <div className="sec-status-ctl">
      <select aria-label={`Estado: ${item.text.slice(0, 40)}`} value={item.exec_status} disabled={disabled || action.busy}
        onChange={async (e) => {
          const r = await action.run(() => call('sec_item_set_status', { p_section: section, p_item: item.id, p_status: e.target.value, p_note: null }), onChanged ? undefined : 'Estado atualizado.');
          if (r.ok) onChanged?.('Estado atualizado.');
        }}>
        {BOARD_STATUSES.map((k) => <option key={k} value={k}>{EXEC_STATUS[k].label}</option>)}
      </select>
      {action.error && <span className="sec-error" role="alert">{action.error}</span>}
      {action.success && <span className="sec-ok" role="status">{action.success}</span>}
    </div>
  );
}

/** Responsável, prazo e atividade, com «Por definir» quando não constam. */
export function TaskFacts({ responsible, team, due, event, overdue }: {
  responsible?: string | null; team?: string | null; due: string | null; event: EventRef | null; overdue?: boolean;
}) {
  const who = [responsible, team].filter(Boolean).join(' · ');
  return (
    <p className="faint sec-meta sec-facts-line">
      <span><User size={13} aria-hidden="true" /> {who || <em>Responsável {UNDEFINED.toLowerCase()}</em>}</span>
      <span className={overdue ? 'sec-overdue-text' : undefined}>
        {overdue && <AlertTriangle size={13} aria-hidden="true" />}
        {due ? `Prazo ${formatDay(due)}${overdue ? ' (em atraso)' : ''}` : <em>Prazo {UNDEFINED.toLowerCase()}</em>}
      </span>
      {event && <span><CalendarDays size={13} aria-hidden="true" /> {event.title}</span>}
    </p>
  );
}

function ItemForm({ minuteId, item, defaultEvent, onDone }: { minuteId: string; item?: Item; defaultEvent?: string | null; onDone: () => void }) {
  const section = useSectionId();
  const people = usePeople();
  const events = useEventOptions();
  const links = useQuery({
    queryKey: ['sec-links', section],
    queryFn: () => call<{ requests: { id: string; label: string }[]; stages: { id: string; label: string }[] }>('sec_link_options', { p_section: section }),
    staleTime: 60_000,
  });
  const action = useAction();
  const [kind, setKind] = useState<ItemKind>(item?.kind ?? 'decisao');
  const [text, setText] = useState(item?.text ?? '');
  const [resp, setResp] = useState(item?.responsible_id ?? '');
  const [team, setTeam] = useState(item?.responsible_team_id ?? '');
  const [due, setDue] = useState(item?.due_date ?? '');
  const [event, setEvent] = useState(item ? item.cal_event_id ?? '' : defaultEvent ?? '');
  const [days, setDays] = useState(String(item?.reminder_days ?? 2));
  const [link, setLink] = useState(item?.trail_request_id ? `r:${item.trail_request_id}` : item?.stage_path_id ? `s:${item.stage_path_id}` : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idp = item?.id ?? 'novo';
  const isTask = kind !== 'decisao';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!text.trim()) errs.text = 'Escreve a decisão, a tarefa ou o preparativo.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await action.run(() => call('sec_item_save', {
      p_section: section, p_item: item?.id ?? null, p_minute: minuteId, p_kind: kind, p_text: text.trim(), p_responsible: resp || null,
      p_due: due || null, p_reminder_days: Number(days), p_request: link.startsWith('r:') ? link.slice(2) : null,
      p_stage_path: link.startsWith('s:') ? link.slice(2) : null, p_team: isTask ? team || null : null, p_event: event || null,
    }), 'Guardado.');
    if (r.ok) onDone();
  }

  return (
    <form className="sec-item-form" onSubmit={submit} noValidate aria-label={item ? 'Alterar registo' : 'Novo registo da ata'}>
      <fieldset>
        <legend>Tipo</legend>
        <div className="row sec-kind-row">
          {(Object.keys(ITEM_KIND) as ItemKind[]).map((k) => (
            <label key={k} className="check-row"><input type="radio" name={`k-${idp}`} checked={kind === k} onChange={() => setKind(k)} />
              {k === 'preparar' ? 'A preparar para a próxima atividade' : ITEM_KIND[k]}</label>
          ))}
        </div>
      </fieldset>
      <Field label="Texto" htmlFor={`it-text-${idp}`}>
        <textarea id={`it-text-${idp}`} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!errors.text} />
        {errors.text && <span className="sec-error">{errors.text}</span>}
      </Field>
      <div className="grid-2">
        <Field label="Responsável" htmlFor={`it-resp-${idp}`} hint={isTask ? 'Se não constar da ata, deixa por definir.' : undefined}>
          <select id={`it-resp-${idp}`} value={resp} onChange={(e) => setResp(e.target.value)}>
            <option value="">{UNDEFINED}</option>
            {(people.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {isTask && (
          <Field label="Equipa responsável" htmlFor={`it-team-${idp}`}>
            <select id={`it-team-${idp}`} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">Nenhuma</option>
              {(people.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Prazo" htmlFor={`it-due-${idp}`}>
          <DateInput id={`it-due-${idp}`} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Atividade associada" htmlFor={`it-ev-${idp}`}>
          <select id={`it-ev-${idp}`} value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">{UNDEFINED}</option>
            {(events.data ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select>
        </Field>
      </div>
      {isTask && resp && due && (
        <Field label="Lembrete ao responsável" htmlFor={`it-days-${idp}`}>
          <select id={`it-days-${idp}`} value={days} onChange={(e) => setDays(e.target.value)}>
            {[0, 1, 2, 3, 7, 14].map((d) => <option key={d} value={d}>{d === 0 ? 'No próprio dia' : d === 1 ? '1 dia antes' : `${d} dias antes`}</option>)}
          </select>
        </Field>
      )}
      {kind === 'decisao' && (
        <Field label="Referência (opcional)" htmlFor={`it-link-${idp}`} hint="Só referência: não valida nem altera o pedido ou a etapa.">
          <select id={`it-link-${idp}`} value={link} onChange={(e) => setLink(e.target.value)}>
            <option value="">Sem referência</option>
            {(links.data?.requests.length ?? 0) > 0 && (
              <optgroup label="Pedidos">{links.data!.requests.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.label}</option>)}</optgroup>
            )}
            {(links.data?.stages.length ?? 0) > 0 && (
              <optgroup label="Etapas">{links.data!.stages.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.label}</option>)}</optgroup>
            )}
          </select>
        </Field>
      )}
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>{action.busy ? 'A guardar…' : 'Guardar'}</button>
        <button type="button" className="btn secondary" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

function ItemRow({ i, canEdit, onEdit, canStatus }: { i: Item; canEdit: boolean; onEdit: () => void; canStatus: boolean }) {
  return (
    <>
      <div className="grow">
        <p className="sec-item-text"><span className="sec-kind">{ITEM_KIND[i.kind]}</span> {i.text}</p>
        {i.kind !== 'decisao'
          ? <TaskFacts responsible={i.responsible_name} team={i.team_name} due={i.due_date} event={i.cal_event} overdue={i.overdue} />
          : (i.responsible_name || i.cal_event) && <TaskFacts responsible={i.responsible_name} due={i.due_date} event={i.cal_event} />}
        {i.link_label && <p className="faint sec-meta"><Link2 size={13} aria-hidden="true" /> {i.link_label}</p>}
        <div className="row sec-item-actions">
          {i.kind !== 'decisao' && <Link className="btn ghost sec-small" to={`${BASE}/tarefas/${i.id}`}>Ficha e histórico</Link>}
          {canEdit && <button type="button" className="btn ghost sec-small" onClick={onEdit}>Alterar</button>}
        </div>
      </div>
      {i.kind !== 'decisao' && (canStatus ? <ItemStatusControl item={i} /> : <Badge {...EXEC_STATUS[i.exec_status]} />)}
    </>
  );
}

export function ItemsSection({ minuteId, items, canEdit, canTrack, meetingActive, defaultEvent }: {
  minuteId: string; items: Item[]; canEdit: boolean; canTrack: boolean; meetingActive: boolean; defaultEvent?: string | null;
}) {
  const me = useActiveSection().userId;
  const [editing, setEditing] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const finish = (msg: string) => { setEditing(null); setDone(msg); };
  const groups: { kind: ItemKind; title: string; empty: string }[] = [
    { kind: 'decisao', title: 'Decisões tomadas', empty: 'Sem decisões registadas.' },
    { kind: 'tarefa', title: 'Tarefas', empty: 'Sem tarefas registadas.' },
    { kind: 'preparar', title: 'A preparar para a próxima atividade', empty: 'Nada registado.' },
  ];
  return (
    <section className="card" aria-labelledby="sec-items-h">
      <div className="row between">
        <h2 className="sec-h2" id="sec-items-h">Decisões, tarefas e preparativos</h2>
        {canEdit && editing !== 'novo' && (
          <button type="button" className="btn secondary" onClick={() => { setDone(null); setEditing('novo'); }}>
            <Plus size={16} aria-hidden="true" /> Acrescentar
          </button>
        )}
      </div>
      {done && <Notice kind="success">{done}</Notice>}
      {editing === 'novo' && <ItemForm minuteId={minuteId} defaultEvent={defaultEvent} onDone={() => finish('Registo acrescentado.')} />}
      {items.length === 0 && editing !== 'novo' && <p className="faint">Ainda não há decisões, tarefas nem preparativos neste documento.</p>}
      {items.length > 0 && groups.map((g) => {
        const list = items.filter((i) => i.kind === g.kind);
        if (list.length === 0) return null;
        return (
          <div key={g.kind}>
            <h3 className="sec-h3">{g.title}</h3>
            <ul className="list sec-items">
              {list.map((i) => (
                <li key={i.id} className={`sec-item${i.overdue ? ' is-overdue' : ''}`}>
                  {editing === i.id ? (
                    <ItemForm minuteId={minuteId} item={i} onDone={() => finish('Registo guardado.')} />
                  ) : (
                    <ItemRow i={i} canEdit={canEdit} onEdit={() => { setDone(null); setEditing(i.id); }}
                      canStatus={meetingActive && (canTrack || i.responsible_id === me)} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
