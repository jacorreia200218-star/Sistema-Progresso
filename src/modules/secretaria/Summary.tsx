// Sumário estruturado de uma reunião: o rascunho é preparado só com o que está registado na ata
// (decisões, tarefas e preparativos; o que não consta fica «Por definir»). Quem redige revê e
// edita; publicar é um passo explícito de quem aprova, com a ata aprovada. Uma versão publicada
// nunca muda: rever cria uma nova versão com motivo.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { History, RefreshCw } from 'lucide-react';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { formatLisbon, todayLisbon } from '../common';
import { TaskFacts } from './Items';
import {
  BASE, EXEC_STATUS, KIND_LABEL, UNDEFINED, useEventOptions, usePeople, useSectionId, useSummary,
  type ItemKind, type SummaryDetail, type SummaryEntry,
} from './api';

const GROUPS: { kind: ItemKind; title: string; empty: string }[] = [
  { kind: 'decisao', title: 'O que ficou decidido', empty: 'Nenhuma decisão registada na ata.' },
  { kind: 'tarefa', title: 'Próximas tarefas', empty: 'Nenhuma tarefa registada na ata.' },
  { kind: 'preparar', title: 'A preparar para a próxima atividade', empty: 'Nada registado na ata.' },
];

function EntryEditor({ e, n, onChange, people, teams, events }: {
  e: SummaryEntry; n: number; onChange: (patch: Partial<SummaryEntry>) => void;
  people: { id: string; name: string }[]; teams: { id: string; name: string }[]; events: { id: string; title: string }[];
}) {
  const id = `se-${n}`;
  return (
    <li className={`sec-entry${e.omitted ? ' is-omitted' : ''}`}>
      <Field label={e.kind === 'decisao' ? 'Decisão' : e.kind === 'tarefa' ? 'Tarefa' : 'Preparativo'} htmlFor={`${id}-t`}>
        <textarea id={`${id}-t`} rows={2} maxLength={2000} value={e.text} disabled={e.omitted} onChange={(x) => onChange({ text: x.target.value })}
          aria-invalid={!e.omitted && !e.text.trim()} />
        {!e.omitted && !e.text.trim() && <span className="sec-error">Escreve o texto deste ponto.</span>}
      </Field>
      {e.kind !== 'decisao' && !e.omitted && (
        <div className="grid-2">
          <Field label="Responsável" htmlFor={`${id}-r`}>
            <select id={`${id}-r`} value={e.responsible_id ?? ''} onChange={(x) => onChange({ responsible_id: x.target.value || null })}>
              <option value="">{UNDEFINED}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Equipa responsável" htmlFor={`${id}-e`}>
            <select id={`${id}-e`} value={e.team_id ?? ''} onChange={(x) => onChange({ team_id: x.target.value || null })}>
              <option value="">Nenhuma</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Prazo" htmlFor={`${id}-d`}>
            <input id={`${id}-d`} type="date" value={e.due_date ?? ''} onChange={(x) => onChange({ due_date: x.target.value || null })} />
          </Field>
          <Field label="Atividade" htmlFor={`${id}-a`}>
            <select id={`${id}-a`} value={e.cal_event_id ?? ''} onChange={(x) => onChange({ cal_event_id: x.target.value || null })}>
              <option value="">{UNDEFINED}</option>
              {e.cal_event && !events.some((x) => x.id === e.cal_event!.id) && <option value={e.cal_event.id}>{e.cal_event.title}</option>}
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
            </select>
          </Field>
        </div>
      )}
      <label className="check-row sec-omit">
        <input type="checkbox" checked={e.omitted} onChange={(x) => onChange({ omitted: x.target.checked })} /> Não incluir no sumário
      </label>
    </li>
  );
}

function ReadOnly({ d }: { d: SummaryDetail }) {
  const entries = (d.version?.content.entries ?? []).filter((e) => !e.omitted);
  return (
    <>
      {GROUPS.map((g) => {
        const list = entries.filter((e) => e.kind === g.kind);
        return (
          <section key={g.kind} className="card" aria-labelledby={`sum-${g.kind}`}>
            <h2 className="sec-h2" id={`sum-${g.kind}`}>{g.title}</h2>
            {list.length === 0 ? <p className="faint">{g.kind === 'decisao' ? 'Sem decisões neste sumário.' : 'Nada neste sumário.'}</p> : (
              <ul className="list sec-items">
                {list.map((e) => {
                  const st = d.item_status[e.item_id];
                  const overdue = !!e.due_date && (st === 'por_fazer' || st === 'em_curso') && e.due_date < todayLisbon();
                  return (
                    <li key={e.item_id} className="sec-item">
                      <div className="grow">
                        <p className="sec-item-text">{e.kind === 'decisao' ? e.text : <Link to={`${BASE}/tarefas/${e.item_id}`}>{e.text}</Link>}</p>
                        {e.kind !== 'decisao' && <TaskFacts responsible={e.responsible_name} team={e.team_name} due={e.due_date} event={e.cal_event ?? null} overdue={overdue} />}
                      </div>
                      {e.kind !== 'decisao' && st && <Badge {...EXEC_STATUS[st]} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}

export function SummaryPage() {
  const { id } = useParams();
  const section = useSectionId();
  const [params, setParams] = useSearchParams();
  const asked = params.get('versao');
  const q = useSummary(id, asked && /^\d+$/.test(asked) ? Number(asked) : null);
  const d = q.data;
  const people = usePeople(!!d?.can_edit);
  const events = useEventOptions(!!d?.can_edit);
  const action = useAction();
  const [entries, setEntries] = useState<SummaryEntry[]>([]);
  const [loadedFor, setLoadedFor] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [revising, setRevising] = useState(false);
  const key = d?.version ? `${d.summary?.id}:${d.version.version_no}:${d.version.updated_at}` : '';
  useEffect(() => {
    if (d?.version && key !== loadedFor) { setEntries(d.version.content.entries.map((e) => ({ ...e }))); setLoadedFor(key); }
  }, [d, key, loadedFor]);

  if (q.isLoading) return <Loading />;
  if (q.error || !d) return (<><PageTitle title="Sumário" back={`${BASE}/reunioes/${id}`} /><ErrorBox error={q.error ?? 'Registo não encontrado.'} /></>);

  const goVersion = (n: number | null) => setParams(() => {
    const next = new URLSearchParams(window.location.search);
    if (n == null) next.delete('versao'); else next.set('versao', String(n));
    return next;
  });
  const s = d.summary;
  const v = d.version;
  const isCurrent = !!v && !!s && v.version_no === s.current_version;
  const editable = d.can_edit && isCurrent;
  const original = JSON.stringify(v?.content.entries.map(({ item_id, kind, text, responsible_id, team_id, due_date, cal_event_id, omitted }) =>
    ({ item_id, kind, text, responsible_id, team_id, due_date, cal_event_id, omitted })) ?? []);
  const current = JSON.stringify(entries.map(({ item_id, kind, text, responsible_id, team_id, due_date, cal_event_id, omitted }) =>
    ({ item_id, kind, text, responsible_id, team_id, due_date, cal_event_id, omitted })));
  const dirty = editable && original !== current;
  const invalid = entries.some((e) => !e.omitted && !e.text.trim());

  const prepare = () => action.run(() => call('sec_summary_prepare', { p_section: section, p_meeting: d.meeting.id }),
    s ? 'Rascunho atualizado com os registos novos da ata.' : 'Rascunho do sumário preparado a partir da ata. Revê-o antes de publicar.');
  const save = () => action.run(() => call('sec_summary_save', { p_section: section, p_summary: s!.id, p_entries: entries, p_expected_version: s!.current_version }), 'Rascunho guardado.');
  const publish = () => action.run(() => call('sec_summary_publish', { p_section: section, p_summary: s!.id, p_expected_version: s!.current_version }),
    'Sumário publicado. Os destinatários foram avisados na aplicação.');
  const revise = async () => {
    if (!reason.trim()) { setReasonError('Indica o motivo da revisão.'); return; }
    setReasonError('');
    const r = await action.run(() => call<number>('sec_summary_revise', { p_section: section, p_summary: s!.id, p_reason: reason.trim() }),
      'Nova versão em rascunho. A versão publicada continua em vigor até publicares esta.');
    if (r.ok) { setRevising(false); setReason(''); goVersion(null); }
  };
  const patch = (n: number, p: Partial<SummaryEntry>) => setEntries((xs) => xs.map((x, i) => (i === n ? { ...x, ...p } : x)));

  return (
    <>
      <PageTitle title={`Sumário · ${d.meeting.title}`} back={`${BASE}/reunioes/${d.meeting.id}`}
        subtitle={<>{formatLisbon(d.meeting.starts_at)} · {KIND_LABEL[d.meeting.kind]}{d.meeting.team_name ? ` · ${d.meeting.team_name}` : ''}</>} />
      {s && (
        <div className="sec-status-bar">
          {s.status === 'publicado' ? <Badge label="Publicado" tone="ok" icon="check" /> : <Badge label="Em revisão" tone="attention" icon="pencil" />}
          {s.published_version && s.status !== 'publicado' && <span className="faint sec-meta">Versão publicada em vigor: {s.published_version}</span>}
          {v && <span className="faint sec-meta">Versão {v.version_no}</span>}
        </div>
      )}
      {v && !isCurrent && (
        <Notice kind="warn">Estás a ver a versão {v.version_no}. <button type="button" className="link-btn" onClick={() => goVersion(null)}>Ver a versão atual</button></Notice>
      )}
      {d.meeting.status === 'anulada' && <Notice kind="warn">A reunião foi anulada. O sumário fica só para consulta.</Notice>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}

      {!s && (
        <div className="card">
          <Empty title="Ainda não há sumário desta reunião.">
            <p className="prose faint">
              O sumário é preparado a partir do que ficou registado na ata: decisões, tarefas com responsável e prazo, e o que é
              preciso preparar para a próxima atividade. Nada é inventado — o que não consta da ata fica «{UNDEFINED}» até alguém
              o rever. Depois de revisto, é publicado por quem aprova.
            </p>
            {d.can_prepare && <div className="btn-row sec-center"><button type="button" className="btn" disabled={action.busy} onClick={prepare}>Preparar sumário a partir da ata</button></div>}
            {!d.ata && <p className="faint sec-center-text">Cria primeiro a ata da reunião.</p>}
          </Empty>
        </div>
      )}

      {s && !v && (
        <div className="card"><Empty title="O sumário ainda está a ser revisto."><p className="faint sec-center-text">Quando for publicado, aparece aqui.</p></Empty></div>
      )}

      {v && editable && (
        <>
          <p className="prose faint sec-note">
            Revê cada ponto antes de publicar. Os títulos das tarefas e dos preparativos aparecem a quem é responsável, mesmo que não
            tenha acesso à ata: não incluas conteúdo reservado. Ao publicar, os responsáveis, prazos e atividades revistos passam
            para o quadro de tarefas.
          </p>
          {d.missing_items > 0 && (
            <Notice>
              {d.missing_items === 1 ? 'Há 1 registo novo na ata' : `Há ${d.missing_items} registos novos na ata`} que ainda não está no sumário.{' '}
              <button type="button" className="link-btn" disabled={action.busy || dirty} onClick={prepare}><RefreshCw size={13} aria-hidden="true" /> Atualizar a partir da ata</button>
            </Notice>
          )}
          {GROUPS.map((g) => {
            const list = entries.map((e, n) => ({ e, n })).filter((x) => x.e.kind === g.kind);
            return (
              <section key={g.kind} className="card" aria-labelledby={`sum-${g.kind}`}>
                <h2 className="sec-h2" id={`sum-${g.kind}`}>{g.title}</h2>
                {list.length === 0 ? <p className="faint">{g.empty}</p> : (
                  <ul className="sec-entries">
                    {list.map(({ e, n }) => (
                      <EntryEditor key={e.item_id} e={e} n={n} onChange={(p) => patch(n, p)}
                        people={people.data?.people ?? []} teams={people.data?.teams ?? []} events={events.data ?? []} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          <div className="card sec-actions">
            <div className="btn-row">
              <button type="button" className="btn secondary" disabled={!dirty || invalid || action.busy} onClick={save}>{action.busy ? 'A guardar…' : 'Guardar rascunho'}</button>
              {d.can_publish && (
                <ConfirmButton className="btn" disabled={dirty || action.busy} confirmLabel={`Publicar versão ${v.version_no}`} onConfirm={publish}
                  description="A versão fica fechada. Quem vê a reunião e quem tem tarefas atribuídas recebe um aviso na aplicação (sem conteúdo da ata).">
                  Publicar sumário
                </ConfirmButton>
              )}
            </div>
            {dirty && <p className="faint sec-meta">Tens alterações por guardar.</p>}
            {!d.can_publish && d.ata?.approved_version == null && <p className="faint sec-meta">Para publicar, a ata tem de estar aprovada.</p>}
            {!d.can_publish && d.ata?.approved_version != null && <p className="faint sec-meta">A publicação cabe a quem aprova atas ou aos dirigentes.</p>}
          </div>
        </>
      )}

      {v && !editable && (
        <>
          {v.published && <p className="faint sec-meta">Publicado em {formatLisbon(v.published_at!)}{v.published_by_name ? ` por ${v.published_by_name}` : ''}.</p>}
          {!v.published && <Notice>Esta versão ainda não foi publicada.</Notice>}
          <ReadOnly d={d} />
          {isCurrent && d.can_revise && (
            <div className="card">
              <p className="prose faint">O sumário publicado não muda. Para o corrigir, cria uma nova versão: a publicada continua em vigor até a nova ser publicada.</p>
              {!revising ? <button type="button" className="btn secondary" onClick={() => setRevising(true)}>Rever com nova versão</button> : (
                <div className="sec-inline-form">
                  <Field label="Motivo da revisão" htmlFor="sum-reason">
                    <input id="sum-reason" type="text" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!reasonError} />
                    {reasonError && <span className="sec-error">{reasonError}</span>}
                  </Field>
                  <div className="btn-row">
                    <button type="button" className="btn" disabled={action.busy} onClick={revise}>Criar nova versão</button>
                    <button type="button" className="btn secondary" onClick={() => setRevising(false)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {d.versions.length > 0 && (
        <section className="card" aria-labelledby="sum-hist-h">
          <h2 className="sec-h2" id="sum-hist-h"><History size={16} aria-hidden="true" /> Versões do sumário</h2>
          <ol className="sec-versions">
            {d.versions.map((x) => (
              <li key={x.version_no} aria-current={v && x.version_no === v.version_no ? 'true' : undefined}>
                <button type="button" className="link-btn" onClick={() => goVersion(s && x.version_no === s.current_version ? null : x.version_no)}>Versão {x.version_no}</button>{' '}
                {x.published_at ? <Badge label={s?.published_version === x.version_no ? 'Publicada' : 'Publicada (substituída)'} tone="ok" /> : <Badge label="Rascunho" tone="neutral" />}
                <div className="faint sec-meta">
                  Criada em {formatLisbon(x.created_at)} por {x.created_by_name}
                  {x.published_at && ` · publicada por ${x.published_by_name} em ${formatLisbon(x.published_at)}`}
                  {x.note && ` · ${x.note}`}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
