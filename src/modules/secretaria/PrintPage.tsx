// Página de impressão limpa de uma versão da ata (imprimir ou guardar em PDF).
import { useParams, useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { useEffect } from 'react';
import { Back, ErrorBox, Loading } from '../../components/ui';
import { formatDay, formatLisbon } from '../common';
import { BASE, ITEM_KIND, KIND_LABEL, MINUTE_STATUS, docLabel, useMinute } from './api';

export function PrintPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const asked = params.get('versao');
  const q = useMinute(id, asked && /^\d+$/.test(asked) ? Number(asked) : null);
  useEffect(() => { if (q.data) document.title = `${docLabel(q.data.minute.kind)} · ${q.data.meeting.title}`; }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? 'Registo não encontrado.'} />;
  const d = q.data;
  const v = d.version;
  const c = v.content;
  const approved = !!v.approved_at;
  return (
    <div className="sec-print">
      <div className="no-print sec-print-tools">
        <Back to={`${BASE}/atas/${d.minute.id}`} />
        <button type="button" className="btn" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Imprimir ou guardar em PDF</button>
      </div>
      <article className="sec-doc" aria-label="Documento para imprimir">
        {d.test && <p className="sec-doc-test">Ambiente de teste — documento sem valor real</p>}
        <header>
          <p className="sec-doc-kind">{docLabel(d.minute.kind)} · {KIND_LABEL[c.kind]}{c.team_name ? ` · ${c.team_name}` : ''}</p>
          <h1>{c.title}</h1>
          <p>{formatLisbon(c.starts_at)}{c.location ? ` · ${c.location}` : ''}</p>
          {c.cal_event_title && <p>Atividade relacionada: {c.cal_event_title}</p>}
          <p className="sec-doc-version">
            Versão {v.version_no} · {approved ? `Aprovada em ${formatDay(v.approved_at!.slice(0, 10))} por ${v.approved_by_name}` : v.frozen ? 'Em aprovação (não aprovada)' : MINUTE_STATUS.rascunho.label + ' (não aprovada)'}
          </p>
        </header>
        <section>
          <h2>Participantes</h2>
          <p>{c.participants.length ? c.participants.join(', ') : '—'}</p>
        </section>
        <section>
          <h2>Assuntos (ordem de trabalhos)</h2>
          <p className="sec-pre">{c.agenda.trim() || '—'}</p>
        </section>
        <section>
          <h2>{d.minute.kind === 'ata' ? 'Ata' : 'Aditamento'}</h2>
          <div className="sec-pre">{v.body.trim() || '—'}</div>
        </section>
        {c.items.length > 0 && (
          <section>
            <h2>Decisões, tarefas e preparativos</h2>
            <ol>
              {c.items.map((i, n) => (
                <li key={n}>
                  <strong>{ITEM_KIND[i.kind] ?? 'Registo'}:</strong> {i.text}
                  {i.kind !== 'decisao' && <> — {[i.responsible_name, i.team_name].filter(Boolean).join(' · ') || 'responsável por definir'}, {i.due_date ? `prazo ${formatDay(i.due_date)}` : 'prazo por definir'}{i.event_title ? ` · ${i.event_title}` : ''}</>}
                  {i.kind === 'decisao' && (i.responsible_name || i.due_date) && <> — {i.responsible_name ?? ''}{i.due_date ? `, prazo ${formatDay(i.due_date)}` : ''}</>}
                  {i.link_label && <> ({i.link_label})</>}
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>
    </div>
  );
}
