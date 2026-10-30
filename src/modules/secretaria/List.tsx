// Atas: lista por data (mais recentes primeiro), com pesquisa no título e no texto.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, FileText, ListChecks, Lock, Plus, Search, UserCheck } from 'lucide-react';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { formatDay, formatLisbonDay } from '../common';
import { BASE, MODULE_NAME, useAtas, useParam } from './api';

export function AtaTabs({ current }: { current: 'atas' | 'tarefas' | 'minhas' }) {
  const tab = (key: typeof current, to: string, icon: ReactNode, label: string) => (
    <Link to={to} className="tab" aria-current={current === key ? 'page' : undefined}>{icon} {label}</Link>
  );
  return (
    <nav className="tabs sec-tabs" aria-label={MODULE_NAME}>
      {tab('atas', BASE, <FileText size={16} aria-hidden="true" />, 'Atas')}
      {tab('tarefas', `${BASE}/tarefas`, <ListChecks size={16} aria-hidden="true" />, 'Tarefas')}
      {tab('minhas', `${BASE}/minhas`, <UserCheck size={16} aria-hidden="true" />, 'As minhas tarefas')}
    </nav>
  );
}

export function AtaList() {
  const [q, setQ] = useParam('q');
  const [text, setText] = useState(q);
  // Pesquisa com pequena pausa, guardada no endereço (sobrevive ao «voltar»).
  useEffect(() => {
    const t = window.setTimeout(() => { if (text !== q) setQ(text); }, 300);
    return () => window.clearTimeout(t);
  }, [text]);
  const list = useAtas(q);
  const data = list.data;

  return (
    <>
      <PageTitle title={MODULE_NAME}
        actions={data?.can_write && <Link to={`${BASE}/nova`} className="btn"><Plus size={16} aria-hidden="true" /> Nova ata</Link>} />
      <AtaTabs current="atas" />
      <label className="search-field sec-search sec-search-row">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Pesquisar atas</span>
        <input type="search" placeholder="Pesquisar atas" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {list.isLoading && <Loading />}
      <ErrorBox error={list.error} retry={() => list.refetch()} />
      {data && data.atas.length === 0 && (
        <div className="card">
          {q ? <Empty title="Nenhuma ata corresponde à pesquisa." /> : (
            <Empty title="Ainda não há atas.">
              {data.can_write ? (
                <>
                  <p className="faint sec-center-text">Cada ata fica ligada a um evento do calendário.</p>
                  <Link to={`${BASE}/nova`} className="btn"><Plus size={16} aria-hidden="true" /> Escrever a primeira ata</Link>
                </>
              ) : <p className="faint sec-center-text">As atas partilhadas contigo aparecem aqui.</p>}
            </Empty>
          )}
        </div>
      )}
      {data && data.atas.length > 0 && (
        <ul className="list card sec-list" aria-label="Atas">
          {data.atas.map((a) => (
            <li key={a.id}>
              <Link to={`${BASE}/atas/${a.id}`} className="list-item sec-row">
                <div className="grow">
                  <div className="sec-row-title">{a.title}</div>
                  <div className="faint sec-meta">
                    {formatDay(a.day)}
                    {a.scope === 'equipa' && a.team_name ? ` · ${a.team_name}` : ''}
                    {' · '}alterada em {formatLisbonDay(a.updated_at)} por {a.updated_by_name}
                  </div>
                </div>
                <div className="sec-row-side">
                  {a.scope === 'dirigentes' && <span className="faint sec-meta sec-open-count"><Lock size={13} aria-hidden="true" /> Reservada</span>}
                  {a.open_tasks > 0 && (
                    <span className="faint sec-meta sec-open-count">
                      <ClipboardList size={13} aria-hidden="true" /> {a.open_tasks} {a.open_tasks === 1 ? 'tarefa aberta' : 'tarefas abertas'}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
