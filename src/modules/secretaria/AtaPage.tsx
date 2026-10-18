// Ata: evento, texto, quem escreveu e quando mudou, versões anteriores e tarefas.
// Guardar cria uma nova versão; as anteriores ficam no histórico (só leitura).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, History, Lock, MapPin, Plus, Users } from 'lucide-react';
import { Empty, ErrorBox, Loading, MoreInfo, MoreOptions, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useSection } from '../../lib/session';
import { formatLisbon, formatLisbonDay, useModule } from '../common';
import { useModuleCtx } from '../ModuleShell';
import { TaskForm, TaskRow } from './Tasks';
import { BASE, SCOPE_LABEL, eventLabel, useAta, useParam, useSectionId, type Ata } from './api';

function Editor({ ata, onDone }: { ata: Ata; onDone: (msg?: string) => void }) {
  const section = useSectionId();
  const action = useAction();
  const [body, setBody] = useState(ata.body);
  const [reserved, setReserved] = useState(ata.scope === 'dirigentes');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!body.trim()) { setError('Escreve o texto da ata.'); return; }
    setError(null);
    const r = await action.run(() => call('ata_save', {
      p_section: section, p_ata: ata.id, p_event: null, p_body: body,
      p_scope: reserved ? 'dirigentes' : 'evento', p_expected_version: ata.current_version,
    }));
    if (r.ok) onDone('Ata guardada.');
  }

  return (
    <div className="sec-form">
      <label className="sr-only" htmlFor="ata-edit">Texto da ata</label>
      <textarea id="ata-edit" rows={14} value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} aria-invalid={!!error} autoFocus />
      {error && <span className="sec-error">{error}</span>}
      <MoreOptions open={ata.scope === 'dirigentes'}>
        <label className="check-row">
          <input type="checkbox" checked={reserved} onChange={(e) => setReserved(e.target.checked)} /> Reservada aos dirigentes
        </label>
      </MoreOptions>
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={action.busy} onClick={save}>{action.busy ? 'A guardar…' : 'Guardar'}</button>
        <button type="button" className="btn secondary" onClick={() => onDone()}>Cancelar</button>
      </div>
    </div>
  );
}

export function AtaPage() {
  const { id = '' } = useParams();
  const [v, setV] = useParam('versao');
  const version = v ? Number(v) : null;
  const q = useAta(id, version);
  const me = useSection().userId;
  const { space } = useModuleCtx();
  const cal = useModule('calendario');
  const [editing, setEditing] = useState(false);
  const [taskForm, setTaskForm] = useState<string | null>(null); // 'new' ou id da tarefa
  const [done, setDone] = useState<string | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <><PageTitle title="Ata" back={BASE} /><ErrorBox error={q.error} retry={() => q.refetch()} /></>;
  const a = q.data;
  const old = a.version !== a.current_version;
  const canEdit = a.can_write && !old;
  // Ligação ao evento só para quem vê o calendário no mesmo espaço.
  const calLink = a.event && cal.space === space ? `/calendario/evento/${a.event.id}` : null;
  const finish = (msg?: string) => { setEditing(false); setTaskForm(null); setDone(msg ?? null); };

  return (
    <>
      <PageTitle title={a.event?.title ?? a.title} back={BASE}
        actions={canEdit && !editing && <button type="button" className="btn secondary" onClick={() => { setDone(null); setEditing(true); }}>Editar</button>} />
      {done && <Notice kind="success">{done}</Notice>}

      <section className="card" aria-label="Ata">
        <div className="sec-facts sec-facts-main">
          {a.event && (
            <p>
              <CalendarDays size={15} aria-hidden="true" />
              {calLink ? <Link to={calLink}>{eventLabel(a.event)}</Link> : eventLabel(a.event)}
            </p>
          )}
          {a.event?.location && <p><MapPin size={15} aria-hidden="true" /> {a.event.location}</p>}
          <p>{a.scope === 'dirigentes' ? <Lock size={15} aria-hidden="true" /> : <Users size={15} aria-hidden="true" />}
            {a.scope === 'equipa' && a.team_name ? `Equipa ${a.team_name}` : SCOPE_LABEL[a.scope]}</p>
        </div>
        {old && (
          <Notice kind="info">
            Versão {a.version} de {a.current_version}. <button type="button" className="link-btn" onClick={() => setV('')}>Ver a versão atual</button>
          </Notice>
        )}
        {editing ? <Editor ata={a} onDone={finish} /> : <div className="sec-body"><p className="sec-pre">{a.body}</p></div>}
        <p className="faint sec-meta sec-note">
          Escrita por {a.created_by_name} · alterada em {formatLisbon(a.updated_at)} por {a.updated_by_name}
        </p>
        {a.versions.length > 1 && (
          <MoreInfo label={`Histórico (${a.versions.length} versões)`}>
            <ul className="sec-versions">
              {a.versions.map((x) => (
                <li key={x.version} aria-current={x.version === a.version ? 'true' : undefined}>
                  <button type="button" className="link-btn" onClick={() => setV(x.version === a.current_version ? '' : String(x.version))}>
                    <History size={13} aria-hidden="true" /> Versão {x.version}
                  </button>
                  <span className="faint sec-meta"> · {formatLisbonDay(x.saved_at)} · {x.saved_by_name}</span>
                </li>
              ))}
            </ul>
          </MoreInfo>
        )}
      </section>

      <section className="card" aria-labelledby="ata-tasks-h">
        <div className="sec-h2-row">
          <h2 className="sec-h2" id="ata-tasks-h">Tarefas</h2>
          {a.can_write && taskForm !== 'new' && (
            <button type="button" className="btn ghost" onClick={() => { setDone(null); setTaskForm('new'); }}>
              <Plus size={16} aria-hidden="true" /> Nova tarefa
            </button>
          )}
        </div>
        {taskForm === 'new' && <TaskForm ata={a.id} onDone={finish} />}
        {a.tasks.length === 0 && taskForm !== 'new' && <Empty title="Sem tarefas." />}
        {a.tasks.length > 0 && (
          <ul className="list sec-items">
            {a.tasks.map((t) => taskForm === t.id
              ? <li key={t.id}><TaskForm ata={a.id} task={t} onDone={finish} /></li>
              : <TaskRow key={t.id} t={t} showAta={false} canChange={a.can_write || t.responsible_id === me}
                  onEdit={a.can_write ? () => { setDone(null); setTaskForm(t.id); } : undefined} />)}
          </ul>
        )}
      </section>
    </>
  );
}
