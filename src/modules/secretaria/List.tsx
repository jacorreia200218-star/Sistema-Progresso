// Atas e reuniões: pesquisa e histórico por texto, data, equipa, tipo e atividade (no endereço).
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardList, FileText, ListChecks, Plus, Search, UserCheck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { formatLisbon } from '../common';
import { BASE, KIND_LABEL, MINUTE_STATUS, MODULE_NAME, useMeetings, useParam, type MeetingKind } from './api';
import { DateInput } from '../../components/DateInput';

export function SecTabs({ current }: { current: 'reunioes' | 'tarefas' | 'mine' }) {
  const tab = (key: typeof current, to: string, icon: ReactNode, label: string) => (
    <Link to={to} className="tab" aria-current={current === key ? 'page' : undefined}>{icon} {label}</Link>
  );
  return (
    <nav className="tabs sec-tabs" aria-label={MODULE_NAME}>
      {tab('reunioes', BASE, <FileText size={16} aria-hidden="true" />, 'Atas e reuniões')}
      {tab('tarefas', `${BASE}/tarefas`, <ListChecks size={16} aria-hidden="true" />, 'Quadro de tarefas')}
      {tab('mine', `${BASE}/o-que-me-diz-respeito`, <UserCheck size={16} aria-hidden="true" />, 'O que me diz respeito')}
    </nav>
  );
}

export function MeetingList() {
  const [q, setQ] = useParam('q');
  const [kind, setKind] = useParam('tipo');
  const [team, setTeam] = useParam('equipa');
  const [event, setEvent] = useParam('atividade');
  const [from, setFrom] = useParam('de');
  const [to, setTo] = useParam('ate');
  const [text, setText] = useState(q);
  // Pesquisa com pequena pausa, guardada no endereço (sobrevive ao «voltar»).
  useEffect(() => {
    const t = window.setTimeout(() => { if (text !== q) setQ(text); }, 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const list = useMeetings({ q, kind, team, event, from, to });
  const data = list.data;
  const filtered = !!(q || kind || team || event || from || to);

  return (
    <>
      <PageTitle title={MODULE_NAME} subtitle="Atas, sumários e tarefas das reuniões, num só sítio." />
      <SecTabs current="reunioes" />
      <div className="sec-toolbar">
        <label className="search-field sec-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Pesquisar reuniões</span>
          <input type="search" placeholder="Pesquisar por título, assuntos, texto da ata ou decisões" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {data?.can_draft && (
          <Link to={`${BASE}/nova`} className="btn"><Plus size={16} aria-hidden="true" /> Nova reunião</Link>
        )}
      </div>
      <div className="sec-filters" role="group" aria-label="Filtros">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filtrar por tipo">
          <option value="">Todos os tipos</option>
          {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filtrar por equipa">
          <option value="">Todas as equipas</option>
          {(data?.teams ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Filtrar por atividade">
          <option value="">Todas as atividades</option>
          {(data?.events ?? []).map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
        </select>
        <label className="sec-date"><span>De</span><DateInput value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde a data" /></label>
        <label className="sec-date"><span>Até</span><DateInput value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até à data" /></label>
      </div>
      {list.isLoading && <Loading />}
      <ErrorBox error={list.error} retry={() => list.refetch()} />
      {data && data.meetings.length === 0 && (
        <div className="card">
          <Empty title={filtered ? 'Nenhuma reunião corresponde à pesquisa.' : 'Ainda não há reuniões que possas ver.'}>
            <p className="faint prose sec-center-text">
              {filtered ? 'Experimenta outros filtros ou limpa a pesquisa.'
                : data.can_draft ? 'Cria a primeira reunião com «Nova reunião».' : 'Quando houver reuniões partilhadas contigo, aparecem aqui.'}
            </p>
          </Empty>
        </div>
      )}
      {data && data.meetings.length > 0 && (
        <ul className="list card sec-list" aria-label="Reuniões">
          {data.meetings.map((m) => (
            <li key={m.id}>
              <Link to={`${BASE}/reunioes/${m.id}`} className="list-item sec-row">
                <div className="grow">
                  <div className="sec-row-title">{m.title}</div>
                  <div className="faint sec-meta">
                    {formatLisbon(m.starts_at)} · {KIND_LABEL[m.kind as MeetingKind]}{m.team_name ? ` · ${m.team_name}` : ''}
                  </div>
                  <div className="faint sec-meta sec-row-extra">
                    {m.cal_event && <span><CalendarDays size={13} aria-hidden="true" /> {m.cal_event.title}</span>}
                    {m.decisions > 0 && <span>{m.decisions} {m.decisions === 1 ? 'decisão' : 'decisões'}</span>}
                    {m.open_tasks > 0 && <span><ClipboardList size={13} aria-hidden="true" /> {m.open_tasks} {m.open_tasks === 1 ? 'tarefa aberta' : 'tarefas abertas'}</span>}
                    {m.summary && <span>{m.summary.status === 'publicado' ? 'Sumário publicado' : 'Sumário em revisão'}</span>}
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
          Dirigentes autorizados são os dirigentes da secção e quem tem permissão para redigir ou aprovar atas. Quem redige
          prepara atas, sumários e tarefas nas reuniões que pode ver; aprovar atas e publicar sumários cabe a quem tem permissão
          de aprovar ou aos dirigentes. Cada pessoa vê, em «O que me diz respeito», as tarefas e os preparativos que lhe foram
          atribuídos — de reuniões reservadas, só o título revisto no sumário publicado, o prazo e a atividade.
        </p>
      </details>
    </>
  );
}
