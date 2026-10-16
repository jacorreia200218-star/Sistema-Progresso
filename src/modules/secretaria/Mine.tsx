// «O que me diz respeito»: tarefas e preparativos atribuídos à pessoa ou à sua equipa.
// De reuniões que a pessoa não vê, o servidor só envia o título revisto no sumário publicado,
// o prazo, o estado e a atividade (nunca texto da ata nem decisões).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, FileText, Users } from 'lucide-react';
import { Badge, Empty, ErrorBox, Loading, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { formatDay } from '../common';
import { SecTabs } from './List';
import { ItemStatusControl } from './Items';
import { BASE, EXEC_STATUS, MODULE_NAME, UNDEFINED, useSectionId, type MineTask } from './api';

function Row({ t, onChanged }: { t: MineTask; onChanged: (m: string) => void }) {
  return (
    <li className={`sec-item${t.overdue ? ' is-overdue' : ''}`}>
      <div className="grow">
        <p className="sec-item-text">
          <span className="sec-kind">{t.kind === 'preparar' ? 'Preparativo' : 'Tarefa'}</span>{' '}
          <Link to={`${BASE}/tarefas/${t.id}`}>{t.text}</Link>
        </p>
        <p className="faint sec-meta sec-facts-line">
          <span className={t.overdue ? 'sec-overdue-text' : undefined}>
            {t.overdue && <AlertTriangle size={13} aria-hidden="true" />}
            {t.due_date ? `Prazo ${formatDay(t.due_date)}${t.overdue ? ' (em atraso)' : ''}` : <em>Prazo {UNDEFINED.toLowerCase()}</em>}
          </span>
          {t.cal_event && <span><CalendarDays size={13} aria-hidden="true" /> {t.cal_event.title}</span>}
          {t.via === 'equipa' && <span><Users size={13} aria-hidden="true" /> Da equipa{t.team_name ? ` ${t.team_name}` : ''}</span>}
          {t.meeting_id && <span><FileText size={13} aria-hidden="true" /> <Link to={`${BASE}/reunioes/${t.meeting_id}`}>{t.meeting_title}</Link></span>}
        </p>
      </div>
      {t.exec_status === 'concluida' ? <Badge {...EXEC_STATUS.concluida} /> : <ItemStatusControl item={t} onChanged={onChanged} />}
    </li>
  );
}

export function Mine() {
  const section = useSectionId();
  const [done, setDone] = useState<string | null>(null);
  const tasks = useQuery({ queryKey: ['sec-my-tasks', section], queryFn: () => call<MineTask[]>('sec_my_tasks', { p_section: section }) });
  const all = tasks.data ?? [];
  const open = all.filter((t) => t.exec_status !== 'concluida');
  const closed = all.filter((t) => t.exec_status === 'concluida');
  const late = open.filter((t) => t.overdue).length;
  return (
    <>
      <PageTitle title={MODULE_NAME} info={<p>
        As tarefas e os preparativos atribuídos a ti ou à tua equipa. Aqui só aparecem o título, o prazo e a atividade de cada
        tarefa. O conteúdo das atas continua reservado a quem tem acesso a cada reunião.
      </p>} />
      <SecTabs current="mine" />
      {done && <Notice kind="success">{done}</Notice>}
      {tasks.isLoading && <Loading />}
      <ErrorBox error={tasks.error} retry={() => tasks.refetch()} />
      {tasks.data && all.length === 0 && (
        <div className="card">
          <Empty title="Não tens tarefas nem preparativos atribuídos.">
            <p className="faint prose sec-center-text">Quando um sumário de reunião te atribuir uma tarefa, a ti ou à tua equipa, aparece aqui e recebes um aviso.</p>
          </Empty>
        </div>
      )}
      {late > 0 && <Notice kind="warn">{late === 1 ? 'Tens 1 tarefa em atraso.' : `Tens ${late} tarefas em atraso.`}</Notice>}
      {open.length > 0 && (
        <section className="card" aria-labelledby="sec-mine-open">
          <h2 className="sec-h2" id="sec-mine-open">Por concluir</h2>
          <ul className="list sec-items">{open.map((t) => <Row key={t.id} t={t} onChanged={setDone} />)}</ul>
        </section>
      )}
      {closed.length > 0 && (
        <section className="card" aria-labelledby="sec-mine-done">
          <h2 className="sec-h2" id="sec-mine-done">Concluídas</h2>
          <ul className="list sec-items">{closed.map((t) => <Row key={t.id} t={t} onChanged={setDone} />)}</ul>
        </section>
      )}
    </>
  );
}
