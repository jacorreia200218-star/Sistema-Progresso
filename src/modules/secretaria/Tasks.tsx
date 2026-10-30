// Tarefas das atas: lista geral, «As minhas tarefas» e o formulário de tarefa (título, o que
// fazer, responsável, participantes, prazo e estado). O responsável muda o estado; quem
// escreve atas cria, reatribui e edita. Os participantes veem a tarefa em «As minhas
// tarefas», mas isso não lhes dá acesso à ata (o servidor só envia a ligação a quem a vê).
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ChevronDown, FileText, User, Users } from 'lucide-react';
import { Badge, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { DateInput } from '../../components/DateInput';
import { PeopleMultiSelect } from '../../components/PeopleMultiSelect';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { confirmDiscard, useUnsavedWarning } from '../../lib/useUnsaved';
import { useSection } from '../../lib/session';
import { functionLabel } from '../../lib/labels';
import type { MemberFunction } from '../../lib/types';
import { formatDay } from '../common';
import { AtaTabs } from './List';
import { PersonPicker } from './PersonPicker';
import { BASE, MODULE_NAME, TASK_STATUS, eventWhen, taskTitle, useParam, usePeople, useSectionId, type Task, type TaskStatus } from './api';

export function StatusSelect({ task }: { task: Task }) {
  const section = useSectionId();
  const action = useAction();
  return (
    <div className="sec-status-ctl">
      <select aria-label={`Estado de «${taskTitle(task)}»`} value={task.status} disabled={action.busy}
        onChange={(e) => action.run(() => call('ata_task_status', { p_section: section, p_task: task.id, p_status: e.target.value }))}>
        {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
      </select>
      {action.error && <span className="sec-error" role="alert">{action.error}</span>}
    </div>
  );
}

/** Nomes dos participantes: os três primeiros e «+N» (a lista completa fica no title e ao abrir). */
function participantsLine(t: Task) {
  const names = (t.participants ?? []).map((p) => p.name);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}

/** Uma tarefa: título, responsável, participantes, prazo, estado; ao abrir, «O que fazer». */
export function TaskRow({ t, canChange, showAta = true, onEdit }: { t: Task; canChange: boolean; showAta?: boolean; onEdit?: () => void }) {
  const [open, setOpen] = useState(false);
  const people = t.participants ?? [];
  // Tarefas antigas não têm título: o texto faz de título e não há nada mais para abrir.
  const details = t.title ? t.text : null;
  const detailsId = `task-${t.id}-o-que-fazer`;
  return (
    <li className={`sec-item${t.overdue ? ' is-overdue' : ''}`}>
      <div className="grow">
        {details ? (
          <button type="button" className="sec-task-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
            <span className="sec-item-text sec-task-title">{taskTitle(t)}</span>
            <ChevronDown size={16} aria-hidden="true" className="sec-task-chevron" />
          </button>
        ) : <p className="sec-item-text">{t.text}</p>}
        <p className="faint sec-meta sec-facts-line">
          <span><User size={13} aria-hidden="true" /> <span className="sr-only">Responsável:</span>{t.responsible_name}</span>
          {people.length > 0 && (
            <span title={people.map((p) => p.name).join(', ')}>
              <Users size={13} aria-hidden="true" /> <span className="sr-only">Participantes:</span>{participantsLine(t)}
            </span>
          )}
          {t.due_date && (
            <span className={t.overdue ? 'sec-overdue-text' : undefined}>
              {t.overdue && <AlertTriangle size={13} aria-hidden="true" />}
              Até {formatDay(t.due_date)}{t.overdue ? ' (em atraso)' : ''}
            </span>
          )}
          {t.event && <span><CalendarDays size={13} aria-hidden="true" /> {t.event.title} · {eventWhen(t.event)}</span>}
          {showAta && t.ata_id && <span><FileText size={13} aria-hidden="true" /> <Link to={`${BASE}/atas/${t.ata_id}`}>Ver ata</Link></span>}
          {t.my_role === 'participante' && <span><Badge label="Participas" tone="neutral" /></span>}
        </p>
        {details && open && (
          <div className="sec-task-details" id={detailsId}>
            <h3 className="sec-task-h">O que fazer</h3>
            <p className="sec-pre">{details}</p>
            <p className="faint sec-meta">
              Responsável: {t.responsible_name}
              {people.length > 0 && <><br />Participantes: {people.map((p) => p.team_name ? `${p.name} (${p.team_name})` : p.name).join(', ')}</>}
            </p>
          </div>
        )}
        {onEdit && <button type="button" className="link-btn sec-meta sec-edit" onClick={onEdit}>Editar</button>}
      </div>
      {canChange ? <StatusSelect task={t} /> : <Badge {...TASK_STATUS[t.status]} />}
    </li>
  );
}

/** Criar ou editar uma tarefa de uma ata. Ao editar, mantém as escolhas existentes. */
export function TaskForm({ ata, task, onDone }: { ata: string; task?: Task; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useAction();
  const people = usePeople();
  const initial = {
    title: task?.title ?? '', text: task?.text ?? '', who: task?.responsible_id ?? '', due: task?.due_date ?? '',
    status: task?.status ?? ('por_fazer' as TaskStatus), participants: (task?.participants ?? []).map((p) => p.id),
  };
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<{ title?: string; text?: string; who?: string }>({});
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  useUnsavedWarning(dirty && !action.busy);
  const fid = task ? `t-${task.id}` : 't-new';
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  // O título só é obrigatório nas tarefas novas (as antigas podem ficar sem ele).
  const needsTitle = !task || !!task.title;

  const options = (people.data ?? []).map((p) => ({
    id: p.id, label: p.name, team: p.team_name,
    detail: p.function ? functionLabel[p.function as MemberFunction] : undefined,
    disabled: p.id === f.who, disabledNote: 'responsável',
  }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (action.busy) return;
    const err = {
      title: needsTitle && !f.title.trim() ? 'Dá um título curto à tarefa.' : undefined,
      text: f.text.trim() ? undefined : 'Descreve o que é preciso fazer.',
      who: f.who ? undefined : 'Escolhe o responsável.',
    };
    setErrors(err);
    if (err.title || err.text || err.who) return;
    const r = await action.run(() => call('ata_task_save', {
      p_section: section, p_task: task?.id ?? null, p_ata: task ? null : ata, p_title: f.title.trim() || null, p_text: f.text.trim(),
      p_responsible: f.who, p_due: f.due || null, p_status: f.status, p_participants: f.participants.filter((x) => x !== f.who),
    }));
    if (r.ok) onDone(task ? 'Tarefa guardada.' : 'Tarefa criada. O responsável e os participantes foram avisados.');
  }

  return (
    <form className="sec-item-form" onSubmit={submit} noValidate aria-label={task ? 'Editar tarefa' : 'Nova tarefa'}>
      <Field label={needsTitle ? 'Título' : 'Título (opcional)'} htmlFor={`${fid}-title`}>
        <input id={`${fid}-title`} value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={120}
          aria-invalid={!!errors.title} autoFocus placeholder="Ex.: Reservar o parque" />
        {errors.title && <span className="sec-error">{errors.title}</span>}
      </Field>
      <Field label="O que fazer" htmlFor={`${fid}-text`}>
        <textarea id={`${fid}-text`} rows={3} value={f.text} onChange={(e) => set({ text: e.target.value })} maxLength={2000}
          aria-invalid={!!errors.text} placeholder="O que é preciso fazer e o resultado esperado" />
        {errors.text && <span className="sec-error">{errors.text}</span>}
      </Field>
      <div className="sec-grid">
        <Field label="Responsável" htmlFor={`${fid}-who`}>
          <PersonPicker id={`${fid}-who`} value={f.who} invalid={!!errors.who}
            onChange={(who) => set({ who, participants: f.participants.filter((x) => x !== who) })} />
          {errors.who && <span className="sec-error">{errors.who}</span>}
        </Field>
        <Field label="Prazo (opcional)" htmlFor={`${fid}-due`}>
          <DateInput id={`${fid}-due`} value={f.due} onChange={(e) => set({ due: e.target.value })} />
        </Field>
      </div>
      <Field label="Participantes (opcional)" htmlFor={`${fid}-people`}>
        <PeopleMultiSelect id={`${fid}-people`} value={f.participants} onChange={(participants) => set({ participants })}
          options={options} loading={people.isLoading} listLabel="Participantes" />
      </Field>
      {task && (
        <Field label="Estado" htmlFor={`${fid}-status`}>
          <select id={`${fid}-status`} value={f.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s].label}</option>)}
          </select>
        </Field>
      )}
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>{action.busy ? 'A guardar…' : task ? 'Guardar' : 'Criar tarefa'}</button>
        <button type="button" className="btn secondary" disabled={action.busy} onClick={() => { if (confirmDiscard(dirty)) onDone(); }}>Cancelar</button>
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
            <p className="faint sec-center-text">As tarefas criam-se dentro de cada ata.</p>
            <Link to={BASE} className="btn secondary">Ver atas</Link>
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
  const me = useSection().userId;
  const q = useQuery({ queryKey: ['ata-my-tasks', section], queryFn: () => call<Task[]>('ata_my_tasks', { p_section: section }) });
  const all = q.data ?? [];
  const open = all.filter((t) => t.status !== 'concluida');
  const done = all.filter((t) => t.status === 'concluida');
  const late = open.filter((t) => t.overdue && t.responsible_id === me).length;
  // Só o responsável muda o estado; quem participa vê o estado.
  const row = (t: Task) => <TaskRow key={t.id} t={t} canChange={t.responsible_id === me} />;
  return (
    <>
      <PageTitle title={MODULE_NAME} />
      <AtaTabs current="minhas" />
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} retry={() => q.refetch()} />
      {q.data && all.length === 0 && (
        <div className="card">
          <Empty title="Não tens tarefas.">
            <p className="faint sec-center-text">Quando fores responsável ou participante numa tarefa, ela aparece aqui e recebes um aviso.</p>
            <Link to={`${BASE}/tarefas`} className="btn secondary">Ver todas as tarefas</Link>
          </Empty>
        </div>
      )}
      {late > 0 && <Notice kind="warn">{late === 1 ? 'Tens 1 tarefa em atraso.' : `Tens ${late} tarefas em atraso.`}</Notice>}
      {open.length > 0 && (
        <section className="card" aria-labelledby="sec-mine-open">
          <h2 className="sec-h2" id="sec-mine-open">Por concluir</h2>
          <ul className="list sec-items">{open.map(row)}</ul>
        </section>
      )}
      {done.length > 0 && (
        <section className="card" aria-labelledby="sec-mine-done">
          <h2 className="sec-h2" id="sec-mine-done">Concluídas</h2>
          <ul className="list sec-items">{done.map(row)}</ul>
        </section>
      )}
    </>
  );
}
