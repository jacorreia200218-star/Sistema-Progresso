// Tarefas (Por fazer, Em curso, Concluída): três colunas no computador, lista agrupada no telemóvel;
// cartões curtos (título, responsável, prazo, atraso) que abrem a ficha; filtros no endereço.
// Ficha da tarefa: estado, ligação à ata de origem, alterações (em «Mais») e histórico.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Archive, CalendarDays, FileText, History, Pencil, Undo2, User } from 'lucide-react';
import { Badge, Empty, ErrorBox, Field, Filters, Loading, MoreMenu, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatDay, formatLisbon } from '../common';
import { SecTabs } from './List';
import { ItemStatusControl, TaskFacts } from './Items';
import {
  BASE, BOARD_STATUSES, EXEC_STATUS, ITEM_KIND, MODULE_NAME, UNDEFINED, useEventOptions, useParam, usePeople, useSectionId,
  type BoardTask, type EventRef, type TaskDetail,
} from './api';
import { DateInput } from '../../components/DateInput';

const FIELD_LABEL: Record<string, string> = {
  criada: 'Registada', estado: 'Estado', responsavel: 'Responsável', equipa: 'Equipa responsável', prazo: 'Prazo',
  atividade: 'Atividade', texto: 'Texto',
};

function TaskCard({ t }: { t: BoardTask }) {
  const who = [t.responsible_name, t.team_name].filter(Boolean).join(' · ');
  return (
    <li className={`sec-task${t.overdue ? ' is-overdue' : ''}`}>
      <Link to={`${BASE}/tarefas/${t.id}`} className="sec-task-link">
        <span className="sec-task-title">{t.text}</span>
        <span className="sec-task-facts">
          <span><User size={13} aria-hidden="true" /> {who || <em>Responsável {UNDEFINED.toLowerCase()}</em>}</span>
          <span className={t.overdue ? 'sec-overdue-text' : undefined}>
            {t.due_date ? `Prazo ${formatDay(t.due_date)}` : <em>Prazo {UNDEFINED.toLowerCase()}</em>}
          </span>
        </span>
        {(t.overdue || t.kind === 'preparar') && (
          <span className="sec-task-tags">
            {t.overdue && <span className="sec-overdue-badge"><AlertTriangle size={12} aria-hidden="true" /> Em atraso</span>}
            {t.kind === 'preparar' && <span className="sec-tag">Preparativo</span>}
          </span>
        )}
      </Link>
    </li>
  );
}

export function Board() {
  const section = useSectionId();
  const [resp, setResp] = useParam('responsavel');
  const [team, setTeam] = useParam('equipa');
  const [event, setEvent] = useParam('atividade');
  const [archived, setArchived] = useParam('arquivo');
  const people = usePeople();
  const board = useQuery({
    queryKey: ['sec-board', section, resp, team, event, archived],
    queryFn: () => call<{ can_manage: boolean; tasks: BoardTask[]; events: EventRef[] }>('sec_board', {
      p_section: section, p_responsible: resp || null, p_team: team || null, p_event: event || null, p_archived: archived === '1',
    }),
  });
  const tasks = board.data?.tasks ?? [];
  const overdue = tasks.filter((t) => t.overdue).length;
  const filtered = !!(resp || team || event);

  return (
    <>
      <PageTitle title={MODULE_NAME} info={<p>
        As tarefas e os preparativos das reuniões que podes ver. Abre uma tarefa para mudar o estado, o responsável ou o prazo
        e para ver o histórico.
      </p>} />
      <SecTabs current="tarefas" />
      <Filters active={[resp, team, event, archived].filter(Boolean).length}>
        <select value={resp} onChange={(e) => setResp(e.target.value)} aria-label="Filtrar por responsável">
          <option value="">Todos os responsáveis</option>
          {(people.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filtrar por equipa">
          <option value="">Todas as equipas</option>
          {(people.data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Filtrar por atividade">
          <option value="">Todas as atividades</option>
          {(board.data?.events ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </select>
        <label className="check-row sec-archive-toggle">
          <input type="checkbox" checked={archived === '1'} onChange={(e) => setArchived(e.target.checked ? '1' : '')} /> Ver arquivadas
        </label>
      </Filters>
      {board.isLoading && <Loading />}
      <ErrorBox error={board.error} retry={() => board.refetch()} />
      {board.data && overdue > 0 && (
        <Notice kind="warn">{overdue === 1 ? '1 tarefa em atraso.' : `${overdue} tarefas em atraso.`} Estão assinaladas no quadro.</Notice>
      )}
      {board.data && tasks.length === 0 && (
        <div className="card">
          <Empty title={archived === '1' ? 'Não há tarefas arquivadas.' : filtered ? 'Nenhuma tarefa corresponde aos filtros.' : 'Ainda não há tarefas no quadro.'}>
            <p className="faint sec-center-text">As tarefas e os preparativos registados nas atas das reuniões que podes ver aparecem aqui.</p>
          </Empty>
        </div>
      )}
      {board.data && tasks.length > 0 && (archived === '1' ? (
        <section className="card" aria-labelledby="sec-col-arq">
          <h2 className="sec-h2" id="sec-col-arq"><Archive size={16} aria-hidden="true" /> Arquivadas <span className="sec-count">{tasks.length}</span></h2>
          <ul className="sec-task-list">{tasks.map((t) => <TaskCard key={t.id} t={t} />)}</ul>
        </section>
      ) : (
        <div className="sec-board">
          {BOARD_STATUSES.map((s) => {
            const col = tasks.filter((t) => t.exec_status === s);
            return (
              <section key={s} className="card sec-col" aria-labelledby={`sec-col-${s}`}>
                <h2 className="sec-h2" id={`sec-col-${s}`}>{EXEC_STATUS[s].label} <span className="sec-count">{col.length}</span></h2>
                {col.length === 0 ? <p className="faint sec-meta sec-center-text sec-col-empty">Nada nesta coluna.</p>
                  : <ul className="sec-task-list">{col.map((t) => <TaskCard key={t.id} t={t} />)}</ul>}
              </section>
            );
          })}
        </div>
      ))}
    </>
  );
}

function ManageForm({ d, onDone, onCancel }: { d: TaskDetail; onDone: (m: string) => void; onCancel: () => void }) {
  const section = useSectionId();
  const people = usePeople();
  const events = useEventOptions();
  const action = useAction();
  const t = d.task;
  const [resp, setResp] = useState(t.responsible_id ?? '');
  const [team, setTeam] = useState(t.responsible_team_id ?? '');
  const [due, setDue] = useState(t.due_date ?? '');
  const [event, setEvent] = useState(t.cal_event_id ?? '');
  const [note, setNote] = useState('');
  useEffect(() => {
    setResp(t.responsible_id ?? ''); setTeam(t.responsible_team_id ?? ''); setDue(t.due_date ?? ''); setEvent(t.cal_event_id ?? '');
  }, [t.responsible_id, t.responsible_team_id, t.due_date, t.cal_event_id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => call('sec_task_update', {
      p_section: section, p_item: t.id, p_responsible: resp || null, p_team: team || null, p_due: due || null, p_event: event || null,
      p_note: note.trim() || null,
    }));
    if (r.ok) { setNote(''); onDone('Tarefa atualizada. A alteração ficou no histórico.'); }
  };
  return (
    <form className="card" onSubmit={submit} noValidate aria-label="Alterar tarefa">
      <h2 className="sec-h2">Responsável, prazo e atividade</h2>
      <p className="faint sec-meta sec-form-note">A ata aprovada não muda: o que alterares aqui fica registado no histórico desta tarefa.</p>
      <div className="grid-2">
        <Field label="Responsável" htmlFor="tk-resp">
          <select id="tk-resp" value={resp} onChange={(e) => setResp(e.target.value)}>
            <option value="">{UNDEFINED}</option>
            {(people.data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Equipa responsável" htmlFor="tk-team">
          <select id="tk-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Nenhuma</option>
            {(people.data?.teams ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Prazo" htmlFor="tk-due">
          <DateInput id="tk-due" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Atividade associada" htmlFor="tk-ev">
          <select id="tk-ev" value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">{UNDEFINED}</option>
            {t.cal_event && !(events.data ?? []).some((x) => x.id === t.cal_event!.id) && <option value={t.cal_event.id}>{t.cal_event.title}</option>}
            {(events.data ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Nota para o histórico (opcional)" htmlFor="tk-note">
        <input id="tk-note" type="text" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={action.busy}>{action.busy ? 'A guardar…' : 'Guardar alterações'}</button>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

export function TaskPage() {
  const { id } = useParams();
  const section = useSectionId();
  const action = useAction();
  const [done, setDone] = useState<string | null>(null);
  const [mode, setMode] = useState<'' | 'editar' | 'arquivar'>('');
  const q = useQuery({ queryKey: ['sec-task', section, id], queryFn: () => call<TaskDetail>('sec_task', { p_section: section, p_item: id }), enabled: !!id });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return (<><PageTitle title="Tarefa" back={`${BASE}/tarefas`} /><ErrorBox error={q.error ?? 'Registo não encontrado.'} /></>);
  const d = q.data;
  const t = d.task;
  const archived = t.exec_status === 'cancelada';
  const archive = async (to: string, msg: string) => {
    setDone(null);
    const r = await action.run(() => call('sec_item_set_status', { p_section: section, p_item: t.id, p_status: to, p_note: null }), msg);
    if (r.ok) setMode('');
  };
  const pick = (m: typeof mode) => { setDone(null); action.clear(); setMode(m); };
  return (
    <>
      <PageTitle title={t.text} back={d.limited ? `${BASE}/o-que-me-diz-respeito` : `${BASE}/tarefas`}
        actions={d.can_manage && (
          <MoreMenu>
            {!archived && <button type="button" className="btn" onClick={() => pick('editar')}><Pencil size={16} aria-hidden="true" /> Alterar responsável e prazo</button>}
            {archived
              ? <button type="button" className="btn" disabled={action.busy} onClick={() => archive('por_fazer', 'A tarefa voltou ao quadro.')}><Undo2 size={16} aria-hidden="true" /> Voltar ao quadro</button>
              : <button type="button" className="btn" onClick={() => pick('arquivar')}><Archive size={16} aria-hidden="true" /> Arquivar (cancelada)</button>}
          </MoreMenu>
        )} />
      {done && <Notice kind="success">{done}</Notice>}
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <ErrorBox error={action.error} />
      {mode === 'arquivar' && !archived && (
        <div className="card" role="group" aria-label="Confirmação">
          <p className="sec-form-note">A tarefa sai do quadro e fica no arquivo, com o histórico. Não se apaga nada.</p>
          <div className="btn-row">
            <button type="button" className="btn" disabled={action.busy} onClick={() => archive('cancelada', 'Tarefa arquivada.')}>Arquivar tarefa</button>
            <button type="button" className="btn secondary" onClick={() => setMode('')}>Cancelar</button>
          </div>
        </div>
      )}
      {mode === 'editar' && d.can_manage && !archived && (
        <ManageForm d={d} onCancel={() => setMode('')} onDone={(m) => { setMode(''); setDone(m); }} />
      )}
      <section className={`card sec-task-detail${t.overdue ? ' is-overdue' : ''}`} aria-label="Dados da tarefa">
        <div className="sec-status-bar">
          {d.can_status && !archived
            ? <><span className="faint sec-meta">Estado</span><ItemStatusControl item={t} onChanged={(m) => { action.clear(); setDone(m); }} /></>
            : <Badge {...EXEC_STATUS[t.exec_status]} />}
        </div>
        <TaskFacts responsible={t.responsible_name} team={t.team_name} due={t.due_date} event={t.cal_event} overdue={t.overdue} />
        <p className="faint sec-meta sec-facts-line">
          <span>{ITEM_KIND[t.kind]}</span>
          {d.meeting && <span><CalendarDays size={13} aria-hidden="true" /> <Link to={`${BASE}/reunioes/${d.meeting.id}`}>{d.meeting.title}</Link></span>}
          {d.minute && (
            <span><FileText size={13} aria-hidden="true" /> <Link to={`${BASE}/atas/${d.minute.id}`}>{d.minute.kind === 'aditamento' ? 'Aditamento de origem' : 'Ata de origem'}</Link></span>
          )}
        </p>
        {!d.limited && d.published_text && d.published_text !== t.text && (
          <p className="faint sec-meta">No sumário publicado: «{d.published_text}»</p>
        )}
        {d.limited && (
          <p className="faint sec-meta">Esta tarefa foi-te atribuída num sumário publicado. A ata da reunião é reservada a quem tem acesso a ela.</p>
        )}
        {t.completed_at && t.exec_status === 'concluida' && <p className="faint sec-meta">Concluída em {formatLisbon(t.completed_at)}.</p>}
      </section>
      {!d.limited && (
        <section className="card" aria-labelledby="sec-thist-h">
          <h2 className="sec-h2" id="sec-thist-h"><History size={16} aria-hidden="true" /> Histórico de conclusão e alterações</h2>
          {d.history.length === 0 ? <p className="faint">Sem alterações registadas.</p> : (
            <ol className="sec-versions">
              {d.history.map((h, n) => (
                <li key={n}>
                  <strong>{FIELD_LABEL[h.field] ?? h.field}</strong>
                  {h.field === 'criada' ? <> · {h.to}</> : <>: {h.from ?? '—'} → {h.to ?? '—'}</>}
                  <div className="faint sec-meta">{formatLisbon(h.at)}{h.by ? ` · ${h.by}` : ''}{h.note ? ` · ${h.note}` : ''}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}
