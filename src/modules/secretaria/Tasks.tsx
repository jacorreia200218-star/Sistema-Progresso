// Tarefas das atas: lista geral, «As minhas tarefas» e o formulário curto de tarefa.
// O responsável muda o estado; quem escreve atas cria, reatribui e edita.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, FileText } from 'lucide-react';
import { Badge, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { DateInput } from '../../components/DateInput';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useSection } from '../../lib/session';
import { formatDay } from '../common';
import { AtaTabs } from './List';
import { PersonPicker } from './PersonPicker';
import { BASE, MODULE_NAME, TASK_STATUS, eventWhen, useParam, useSectionId, type Task, type TaskStatus } from './api';

export function StatusSelect({ task }: { task: Task }) {
  const section = useSectionId();
  const action = useAction();
  return (
    <div className="sec-status-ctl">
      <select aria-label={`Estado de «${task.text}»`} value={task.status} disabled={action.busy}
        onChange={(e) => action.run(() => call('ata_task_status', { p_section: section, p_task: task.id, p_status: e.target.value }))}>
        {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
      </select>
      {action.error && <span className="sec-error" role="alert">{action.error}</span>}
    </div>
  );
}

/** Uma tarefa: descrição, responsável, prazo, evento e ata. */
export function TaskRow({ t, canChange, showAta = true, onEdit }: { t: Task; canChange: boolean; showAta?: boolean; onEdit?: () => void }) {
  return (
    <li className={`sec-item${t.overdue ? ' is-overdue' : ''}`}>
      <div className="grow">
        <p className="sec-item-text">{t.text}</p>
        <p className="faint sec-meta sec-facts-line">
          <span>{t.responsible_name}</span>
          {t.due_date && (
            <span className={t.overdue ? 'sec-overdue-text' : undefined}>
              {t.overdue && <AlertTriangle size={13} aria-hidden="true" />}
              Até {formatDay(t.due_date)}{t.overdue ? ' (em atraso)' : ''}
            </span>
          )}
          {t.event && <span><CalendarDays size={13} aria-hidden="true" /> {t.event.title} · {eventWhen(t.event)}</span>}
          {showAta && t.ata_id && <span><FileText size={13} aria-hidden="true" /> <Link to={`${BASE}/atas/${t.ata_id}`}>Ver ata</Link></span>}
        </p>
        {onEdit && <button type="button" className="link-btn sec-meta sec-edit" onClick={onEdit}>Editar</button>}
      </div>
      {canChange ? <StatusSelect task={t} /> : <Badge {...TASK_STATUS[t.status]} />}
    </li>
  );
}

/** Criar ou editar uma tarefa de uma ata. */
export function TaskForm({ ata, task, onDone }: { ata: string; task?: Task; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useAction();
  const [text, setText] = useState(task?.text ?? '');
  const [who, setWho] = useState(task?.responsible_id ?? '');
  const [due, setDue] = useState(task?.due_date ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'por_fazer');
  const [errors, setErrors] = useState<{ text?: string; who?: string }>({});
  const fid = task ? `t-${task.id}` : 't-new';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const err = { text: text.trim() ? undefined : 'Descreve a tarefa.', who: who ? undefined : 'Escolhe o responsável.' };
    setErrors(err);
    if (err.text || err.who) return;
    const r = await action.run(() => call('ata_task_save', {
      p_section: section, p_task: task?.id ?? null, p_ata: task ? null : ata, p_text: text.trim(),
      p_responsible: who, p_due: due || null, p_status: status,
    }));
    if (r.ok) onDone(task ? 'Tarefa guardada.' : 'Tarefa criada. O responsável foi avisado.');
  }

  return (
    <form className="sec-item-form" onSubmit={submit} noValidate>
      <Field label="Tarefa" htmlFor={`${fid}-text`}>
        <input id={`${fid}-text`} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} aria-invalid={!!errors.text} autoFocus />
        {errors.text && <span className="sec-error">{errors.text}</span>}
      </Field>
      <div className="sec-grid">
        <Field label="Responsável" htmlFor={`${fid}-who`}>
          <PersonPicker id={`${fid}-who`} value={who} onChange={setWho} invalid={!!errors.who} />
          {errors.who && <span className="sec-error">{errors.who}</span>}
        </Field>
        <Field label="Prazo (opcional)" htmlFor={`${fid}-due`}>
          <DateInput id={`${fid}-due`} value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      {task && (
        <Field label="Estado" htmlFor={`${fid}-status`}>
          <select id={`${fid}-status`} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
          </select>
        </Field>
      )}
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>{action.busy ? 'A guardar…' : task ? 'Guardar' : 'Criar tarefa'}</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </form>
  );
}

const FILTERS = { abertas: 'Por concluir', concluidas: 'Concluídas', todas: 'Todas' } as const;

export function TaskList() {
  const section = useSectionId();
  const me = useSection().userId;
  const [filter, setFilter] = useParam('estado');
  const f = (filter in FILTERS ? filter : 'abertas') as keyof typeof FILTERS;
  const q = useQuery({
    queryKey: ['ata-tasks', section, f],
    queryFn: () => call<{ can_write: boolean; tasks: Task[] }>('ata_tasks', { p_section: section, p_filter: f }),
  });
  const tasks = q.data?.tasks ?? [];
  return (
    <>
      <PageTitle title={MODULE_NAME} />
      <AtaTabs current="tarefas" />
      <div className="sec-status-bar">
        <select aria-label="Mostrar tarefas" value={f} onChange={(e) => setFilter(e.target.value === 'abertas' ? '' : e.target.value)}>
          {Object.entries(FILTERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} retry={() => q.refetch()} />
      {q.data && tasks.length === 0 && (
        <div className="card">
          <Empty title={f === 'concluidas' ? 'Ainda não há tarefas concluídas.' : 'Não há tarefas por concluir.'}>
            <p className="faint sec-center-text">As tarefas criam-se dentro de cada ata. <Link to={BASE}>Ver atas</Link></p>
          </Empty>
        </div>
      )}
      {tasks.length > 0 && (
        <ul className="list card sec-items" aria-label="Tarefas">
          {tasks.map((t) => <TaskRow key={t.id} t={t} canChange={!!q.data?.can_write || t.responsible_id === me} />)}
        </ul>
      )}
    </>
  );
}

export function Mine() {
  const section = useSectionId();
  const q = useQuery({ queryKey: ['ata-my-tasks', section], queryFn: () => call<Task[]>('ata_my_tasks', { p_section: section }) });
  const all = q.data ?? [];
  const open = all.filter((t) => t.status !== 'concluida');
  const done = all.filter((t) => t.status === 'concluida');
  const late = open.filter((t) => t.overdue).length;
  return (
    <>
      <PageTitle title={MODULE_NAME} />
      <AtaTabs current="minhas" />
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} retry={() => q.refetch()} />
      {q.data && all.length === 0 && (
        <div className="card">
          <Empty title="Não tens tarefas atribuídas.">
            <p className="faint sec-center-text">Quando uma ata te atribuir uma tarefa, aparece aqui e recebes um aviso.</p>
          </Empty>
        </div>
      )}
      {late > 0 && <Notice kind="warn">{late === 1 ? 'Tens 1 tarefa em atraso.' : `Tens ${late} tarefas em atraso.`}</Notice>}
      {open.length > 0 && (
        <section className="card" aria-labelledby="sec-mine-open">
          <h2 className="sec-h2" id="sec-mine-open">Por concluir</h2>
          <ul className="list sec-items">{open.map((t) => <TaskRow key={t.id} t={t} canChange />)}</ul>
        </section>
      )}
      {done.length > 0 && (
        <section className="card" aria-labelledby="sec-mine-done">
          <h2 className="sec-h2" id="sec-mine-done">Concluídas</h2>
          <ul className="list sec-items">{done.map((t) => <TaskRow key={t.id} t={t} canChange />)}</ul>
        </section>
      )}
    </>
  );
}
