// Decisões e tarefas: lista, formulário (só com o documento em rascunho) e estado de execução.
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link2, Plus } from 'lucide-react';
import { Badge, ErrorBox, Field, Notice } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useActiveSection } from '../../lib/session';
import { formatDay } from '../common';
import { EXEC_STATUS, usePeople, useSectionId, type ExecStatus, type Item } from './api';

export function ItemStatusControl({ item, disabled, onChanged }: { item: Item; disabled?: boolean; onChanged?: (msg: string) => void }) {
  const section = useSectionId();
  const action = useAction();
  return (
    <div className="sec-status-ctl">
      <select aria-label={`Estado: ${item.text.slice(0, 40)}`} value={item.exec_status} disabled={disabled || action.busy}
        onChange={async (e) => {
          const r = await action.run(() => call('sec_item_set_status', { p_section: section, p_item: item.id, p_status: e.target.value, p_note: null }), onChanged ? undefined : 'Estado atualizado.');
          if (r.ok) onChanged?.('Estado atualizado.');
        }}>
        {Object.entries(EXEC_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      {action.error && <span className="sec-error" role="alert">{action.error}</span>}
      {action.success && <span className="sec-ok" role="status">{action.success}</span>}
    </div>
  );
}

function ItemForm({ minuteId, item, onDone }: { minuteId: string; item?: Item; onDone: () => void }) {
  const section = useSectionId();
  const people = usePeople();
  const links = useQuery({
    queryKey: ['sec-links', section],
    queryFn: () => call<{ requests: { id: string; label: string }[]; stages: { id: string; label: string }[] }>('sec_link_options', { p_section: section }),
    staleTime: 60_000,
  });
  const action = useAction();
  const [kind, setKind] = useState<'decisao' | 'tarefa'>(item?.kind ?? 'decisao');
  const [text, setText] = useState(item?.text ?? '');
  const [resp, setResp] = useState(item?.responsible_id ?? '');
  const [due, setDue] = useState(item?.due_date ?? '');
  const [days, setDays] = useState(String(item?.reminder_days ?? 2));
  const [link, setLink] = useState(item?.trail_request_id ? `r:${item.trail_request_id}` : item?.stage_path_id ? `s:${item.stage_path_id}` : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idp = item?.id ?? 'novo';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!text.trim()) errs.text = 'Escreve a decisão ou a tarefa.';
    if (kind === 'tarefa' && !resp) errs.resp = 'Escolhe o responsável.';
    if (kind === 'tarefa' && !due) errs.due = 'Indica o prazo.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await action.run(() => call('sec_item_save', {
      p_section: section, p_item: item?.id ?? null, p_minute: minuteId, p_kind: kind, p_text: text.trim(), p_responsible: resp || null,
      p_due: due || null, p_reminder_days: Number(days), p_request: link.startsWith('r:') ? link.slice(2) : null,
      p_stage_path: link.startsWith('s:') ? link.slice(2) : null,
    }), 'Guardado.');
    if (r.ok) onDone();
  }

  return (
    <form className="sec-item-form" onSubmit={submit} noValidate aria-label={item ? 'Alterar registo' : 'Nova decisão ou tarefa'}>
      <fieldset>
        <legend>Tipo</legend>
        <div className="row">
          <label className="check-row"><input type="radio" name={`k-${idp}`} checked={kind === 'decisao'} onChange={() => setKind('decisao')} /> Decisão</label>
          <label className="check-row"><input type="radio" name={`k-${idp}`} checked={kind === 'tarefa'} onChange={() => setKind('tarefa')} /> Tarefa</label>
        </div>
      </fieldset>
      <Field label="Texto" htmlFor={`it-text-${idp}`}>
        <textarea id={`it-text-${idp}`} rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!errors.text} />
        {errors.text && <span className="sec-error">{errors.text}</span>}
      </Field>
      <div className="grid-2">
        <Field label={kind === 'tarefa' ? 'Responsável' : 'Responsável (opcional)'} htmlFor={`it-resp-${idp}`}>
          <select id={`it-resp-${idp}`} value={resp} onChange={(e) => setResp(e.target.value)} aria-invalid={!!errors.resp}>
            <option value="">Ninguém</option>
            {(people.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errors.resp && <span className="sec-error">{errors.resp}</span>}
        </Field>
        <Field label={kind === 'tarefa' ? 'Prazo' : 'Prazo (opcional)'} htmlFor={`it-due-${idp}`}>
          <input id={`it-due-${idp}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={!!errors.due} />
          {errors.due && <span className="sec-error">{errors.due}</span>}
        </Field>
      </div>
      {kind === 'tarefa' && (
        <Field label="Lembrete ao responsável" htmlFor={`it-days-${idp}`}>
          <select id={`it-days-${idp}`} value={days} onChange={(e) => setDays(e.target.value)}>
            {[0, 1, 2, 3, 7, 14].map((d) => <option key={d} value={d}>{d === 0 ? 'No próprio dia' : d === 1 ? '1 dia antes' : `${d} dias antes`}</option>)}
          </select>
        </Field>
      )}
      <Field label="Referência (opcional)" htmlFor={`it-link-${idp}`} hint="Só referência: não valida nem altera o pedido ou a etapa.">
        <select id={`it-link-${idp}`} value={link} onChange={(e) => setLink(e.target.value)}>
          <option value="">Sem referência</option>
          {(links.data?.requests.length ?? 0) > 0 && (
            <optgroup label="Pedidos">
              {links.data!.requests.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.label}</option>)}
            </optgroup>
          )}
          {(links.data?.stages.length ?? 0) > 0 && (
            <optgroup label="Etapas">
              {links.data!.stages.map((s) => <option key={s.id} value={`s:${s.id}`}>{s.label}</option>)}
            </optgroup>
          )}
        </select>
      </Field>
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>{action.busy ? 'A guardar…' : 'Guardar'}</button>
        <button type="button" className="btn secondary" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

export function ItemsSection({ minuteId, items, canEdit, canTrack, meetingActive }: {
  minuteId: string; items: Item[]; canEdit: boolean; canTrack: boolean; meetingActive: boolean;
}) {
  const me = useActiveSection().userId;
  const [editing, setEditing] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const finish = (msg: string) => { setEditing(null); setDone(msg); };
  return (
    <section className="card" aria-labelledby="sec-items-h">
      <div className="row between">
        <h2 className="sec-h2" id="sec-items-h">Decisões e tarefas</h2>
        {canEdit && editing !== 'novo' && (
          <button type="button" className="btn secondary" onClick={() => { setDone(null); setEditing('novo'); }}>
            <Plus size={16} aria-hidden="true" /> Acrescentar
          </button>
        )}
      </div>
      {done && <Notice kind="success">{done}</Notice>}
      {editing === 'novo' && <ItemForm minuteId={minuteId} onDone={() => finish('Registo acrescentado.')} />}
      {items.length === 0 && editing !== 'novo' && <p className="faint">Ainda não há decisões nem tarefas neste documento.</p>}
      <ul className="list sec-items">
        {items.map((i) => (
          <li key={i.id} className="sec-item">
            {editing === i.id ? (
              <ItemForm minuteId={minuteId} item={i} onDone={() => finish('Registo guardado.')} />
            ) : (
              <>
                <div className="grow">
                  <p className="sec-item-text"><span className="sec-kind">{i.kind === 'tarefa' ? 'Tarefa' : 'Decisão'}</span> {i.text}</p>
                  <p className="faint sec-meta">
                    {i.responsible_name ? `Responsável: ${i.responsible_name}` : 'Sem responsável'}
                    {i.due_date && ` · prazo ${formatDay(i.due_date)}`}
                  </p>
                  {i.link_label && <p className="faint sec-meta"><Link2 size={13} aria-hidden="true" /> {i.link_label}</p>}
                  {canEdit && (
                    <button type="button" className="btn ghost sec-small" onClick={() => { setDone(null); setEditing(i.id); }}>Alterar</button>
                  )}
                </div>
                {i.kind === 'tarefa' && meetingActive && (canTrack || i.responsible_id === me)
                  ? <ItemStatusControl item={i} />
                  : <Badge {...EXEC_STATUS[i.exec_status as ExecStatus]} />}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
