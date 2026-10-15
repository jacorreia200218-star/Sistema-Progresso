// Lista de reuniões (pesquisa e filtro no endereço) e «As minhas tarefas».
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Empty, ErrorBox, Loading, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { formatDay, formatLisbon } from '../common';
import { EXEC_STATUS, KIND_LABEL, MINUTE_STATUS, useMeetings, useSectionId, type Item, type MeetingKind } from './api';
import { ItemStatusControl } from './Items';

function useParam(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? '';
  const set = (v: string) =>
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v) next.set(key, v);
      else next.delete(key);
      return next;
    }, { replace: true });
  return [value, set];
}

export function SecTabs({ current }: { current: 'reunioes' | 'tarefas' }) {
  return (
    <nav className="tabs" aria-label="Secretaria">
      <Link to="/secretaria" className="tab" aria-current={current === 'reunioes' ? 'page' : undefined}>
        <CalendarDays size={16} aria-hidden="true" /> Reuniões
      </Link>
      <Link to="/secretaria/tarefas" className="tab" aria-current={current === 'tarefas' ? 'page' : undefined}>
        <ClipboardList size={16} aria-hidden="true" /> As minhas tarefas
      </Link>
    </nav>
  );
}

export function MeetingList() {
  const [q, setQ] = useParam('q');
  const [kind, setKind] = useParam('tipo');
  const [text, setText] = useState(q);
  // Pesquisa com pequena pausa, guardada no endereço (sobrevive ao «voltar»).
  useEffect(() => {
    const t = window.setTimeout(() => { if (text !== q) setQ(text); }, 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const list = useMeetings(q, kind);
  const data = list.data;

  return (
    <>
      <PageTitle title="Secretaria" subtitle="Reuniões, atas, decisões e tarefas." />
      <SecTabs current="reunioes" />
      <div className="sec-toolbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Pesquisar reuniões</span>
          <input type="search" placeholder="Pesquisar por título ou ordem de trabalhos" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filtrar por tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {data?.can_draft && (
          <Link to="/secretaria/nova" className="btn"><Plus size={16} aria-hidden="true" /> Nova reunião</Link>
        )}
      </div>
      {list.isLoading && <Loading />}
      <ErrorBox error={list.error} retry={() => list.refetch()} />
      {data && data.meetings.length === 0 && (
        <div className="card">
          <Empty title={q || kind ? 'Nenhuma reunião corresponde à pesquisa.' : 'Ainda não há reuniões que possas ver.'}>
            <p className="faint prose sec-center-text">
              {data.can_draft ? 'Cria a primeira reunião com «Nova reunião».' : 'Quando houver reuniões partilhadas contigo, aparecem aqui.'}
            </p>
          </Empty>
        </div>
      )}
      {data && data.meetings.length > 0 && (
        <ul className="list card sec-list" aria-label="Reuniões">
          {data.meetings.map((m) => (
            <li key={m.id}>
              <Link to={`/secretaria/reunioes/${m.id}`} className="list-item sec-row">
                <div className="grow">
                  <div className="sec-row-title">{m.title}</div>
                  <div className="faint sec-meta">
                    {formatLisbon(m.starts_at)} · {KIND_LABEL[m.kind as MeetingKind]}{m.team_name ? ` · ${m.team_name}` : ''}
                    {m.open_tasks > 0 && ` · ${m.open_tasks} ${m.open_tasks === 1 ? 'tarefa aberta' : 'tarefas abertas'}`}
                  </div>
                </div>
                {m.status === 'anulada' ? <Badge label="Anulada" tone="muted" icon="x" />
                  : m.ata ? <Badge {...MINUTE_STATUS[m.ata.status]} />
                  : <Badge label="Sem ata" tone="muted" />}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <details className="sec-help">
        <summary>Quem vê cada reunião</summary>
        <ul className="prose">
          <li><strong>Reunião de Equipa:</strong> os membros dessa equipa e os dirigentes autorizados.</li>
          <li><strong>Conselho de Guias:</strong> os participantes e os dirigentes autorizados.</li>
          <li><strong>Equipa de Animação:</strong> só os dirigentes autorizados.</li>
          <li><strong>Documento geral:</strong> só quem o criou e as pessoas ou equipas com quem foi partilhado.</li>
        </ul>
        <p className="prose faint">
          Dirigentes autorizados são os dirigentes da secção e quem tem permissão de secretário ou de aprovação de atas.
          Os secretários redigem só nas reuniões que podem ver; a aprovação cabe a quem tem permissão de aprovar ou aos dirigentes.
        </p>
      </details>
    </>
  );
}

export function MyTasks() {
  const section = useSectionId();
  const [done, setDone] = useState<string | null>(null);
  const tasks = useQuery({ queryKey: ['sec-my-tasks', section], queryFn: () => call<Item[]>('sec_my_tasks', { p_section: section }) });
  const open = (tasks.data ?? []).filter((t) => t.exec_status === 'por_fazer' || t.exec_status === 'em_curso');
  const closed = (tasks.data ?? []).filter((t) => !open.includes(t));
  const row = (t: Item) => (
    <li key={t.id} className="sec-item">
      <div className="grow">
        <p className="sec-item-text">{t.text}</p>
        <p className="faint sec-meta">
          {t.kind === 'tarefa' ? 'Tarefa' : 'Decisão'}
          {t.due_date && ` · prazo ${formatDay(t.due_date)}`}
          {t.meeting_id && <> · <Link to={`/secretaria/reunioes/${t.meeting_id}`}>{t.meeting_title}</Link></>}
        </p>
      </div>
      {t.kind === 'tarefa' ? <ItemStatusControl item={t} onChanged={setDone} /> : <Badge {...EXEC_STATUS[t.exec_status]} />}
    </li>
  );
  return (
    <>
      <PageTitle title="Secretaria" subtitle="Tarefas e decisões de que és responsável." />
      <SecTabs current="tarefas" />
      {done && <Notice kind="success">{done}</Notice>}
      {tasks.isLoading && <Loading />}
      <ErrorBox error={tasks.error} retry={() => tasks.refetch()} />
      {tasks.data && tasks.data.length === 0 && (
        <div className="card"><Empty title="Não tens tarefas atribuídas."><p className="faint sec-center-text">Quando te atribuírem uma tarefa numa ata, aparece aqui.</p></Empty></div>
      )}
      {open.length > 0 && (
        <section className="card">
          <h2 className="sec-h2">Por concluir</h2>
          <ul className="list sec-items">{open.map(row)}</ul>
        </section>
      )}
      {closed.length > 0 && (
        <section className="card">
          <h2 className="sec-h2">Concluídas ou canceladas</h2>
          <ul className="list sec-items">{closed.map(row)}</ul>
        </section>
      )}
    </>
  );
}
