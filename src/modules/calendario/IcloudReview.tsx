// Gestão › Calendário iCloud › Por rever: o que mudou no iCloud só chega ao Calendário
// depois de aprovado. Numa atividade nova ou alterada, título, local e descrição podem
// ser corrigidos antes de aprovar. Rejeitar guarda a decisão (a mesma versão não volta).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import type { Tone } from '../../lib/labels';
import { Badge, ConfirmButton, ErrorBox, Field, Notice } from '../../components/ui';
import { formatDay, formatLisbon, lisbonTime } from '../common';

type When = { all_day: boolean; starts_at: string | null; ends_at: string | null; start_date: string | null; end_date: string | null };
type Fields = When & { title: string; location: string | null; description: string | null };
export interface InboxItem {
  id: string;
  source_name: string;
  kind: 'nova' | 'alterada' | 'cancelada' | 'removida';
  item: Partial<Fields>;
  current: (Fields & { id: string; status: string }) | null;
}

const KIND: Record<InboxItem['kind'], { label: string; tone: Tone }> = {
  nova: { label: 'Nova', tone: 'progress' },
  alterada: { label: 'Alterada', tone: 'attention' },
  cancelada: { label: 'Cancelada no iCloud', tone: 'muted' },
  removida: { label: 'Removida do iCloud', tone: 'muted' },
};

function when(x: Partial<When>): string {
  if (x.all_day) {
    if (!x.start_date) return '—';
    return x.end_date && x.end_date !== x.start_date ? `${formatDay(x.start_date)} a ${formatDay(x.end_date)}` : formatDay(x.start_date);
  }
  return x.starts_at ? `${formatLisbon(x.starts_at)}${x.ends_at ? `–${lisbonTime(x.ends_at)}` : ''}` : '—';
}

export function IcloudReview() {
  const section = useActiveSection().membership.section_id;
  const q = useQuery({ queryKey: ['cal-inbox', section], queryFn: () => call<InboxItem[]>('cal_source_inbox_list', { p_section: section }) });
  const all = useAction();
  const items = q.data ?? [];
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  if (!items.length) return null;
  const ids = items.map((i) => i.id);
  const decideAll = (d: 'aprovar' | 'rejeitar') =>
    all.run(() => call('cal_source_inbox_decide', { p_section: section, p_ids: ids, p_decision: d }), d === 'aprovar' ? 'Tudo aprovado.' : 'Tudo rejeitado.');
  return (
    <section className="card icloud-review" aria-labelledby="ic-rev-h">
      <div className="icloud-head">
        <h2 id="ic-rev-h">Por rever</h2>
        <Badge label={String(items.length)} tone="attention" />
      </div>
      <ul className="icloud-review-list">
        {items.map((i) => <ReviewRow key={i.id} i={i} />)}
      </ul>
      <ErrorBox error={all.error} />
      {all.success && <Notice kind="success">{all.success}</Notice>}
      {items.length > 1 && (
        <div className="btn-row">
          <ConfirmButton className="btn secondary" confirmLabel={`Aprovar ${items.length}`} disabled={all.busy}
            description="Tudo o que está por rever passa para o Calendário." onConfirm={() => decideAll('aprovar')}>
            Aprovar todas
          </ConfirmButton>
          <ConfirmButton className="btn ghost" confirmLabel={`Rejeitar ${items.length}`} disabled={all.busy}
            description="Nada muda no Calendário. Só volta a aparecer o que mudar outra vez no iCloud." onConfirm={() => decideAll('rejeitar')}>
            Rejeitar todas
          </ConfirmButton>
        </div>
      )}
    </section>
  );
}

function ReviewRow({ i }: { i: InboxItem }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const [edit, setEdit] = useState(false);
  const next = i.kind === 'nova' || i.kind === 'alterada' ? i.item : i.current;
  const [title, setTitle] = useState(next?.title ?? '');
  const [location, setLocation] = useState(next?.location ?? '');
  const [description, setDescription] = useState(next?.description ?? '');
  const editable = i.kind === 'nova' || i.kind === 'alterada';
  const decide = (d: 'aprovar' | 'rejeitar', edits?: Record<string, string>) =>
    action.run(() => call('cal_source_inbox_decide', { p_section: section, p_ids: [i.id], p_decision: d, p_edits: edits ?? null }));
  const k = KIND[i.kind];
  const before = i.kind === 'alterada' && i.current;
  return (
    <li className="icloud-review-row">
      <div className="icloud-review-main">
        <Badge label={k.label} tone={k.tone} />
        <span className="icloud-review-when">{when(next ?? {})}</span>
        <strong className="icloud-review-title">{next?.title ?? '—'}</strong>
        {next?.location && <span className="faint">{next.location}</span>}
        {before && (
          <span className="faint icloud-review-before">
            Antes: {when(before)} · {before.title}{before.location ? ` · ${before.location}` : ''}
          </span>
        )}
      </div>
      {edit ? (
        <form className="icloud-review-edit" onSubmit={(e) => { e.preventDefault(); void decide('aprovar', { title, location, description }); }}>
          <Field label="Título" htmlFor={`rv-t-${i.id}`}><input id={`rv-t-${i.id}`} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Local" htmlFor={`rv-l-${i.id}`}><input id={`rv-l-${i.id}`} maxLength={300} value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          <Field label="Notas" htmlFor={`rv-d-${i.id}`}><textarea id={`rv-d-${i.id}`} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <ErrorBox error={action.error} />
          <div className="btn-row">
            <button type="submit" className="btn" disabled={action.busy || !title.trim()}>Guardar e aprovar</button>
            <button type="button" className="btn ghost" onClick={() => setEdit(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <>
          <ErrorBox error={action.error} />
          <div className="btn-row icloud-review-actions">
            <button type="button" className="btn secondary" disabled={action.busy} onClick={() => void decide('aprovar')}>Aprovar</button>
            {editable && <button type="button" className="btn ghost" disabled={action.busy} onClick={() => setEdit(true)}>Editar</button>}
            <button type="button" className="btn ghost" disabled={action.busy} onClick={() => void decide('rejeitar')}>Rejeitar</button>
          </div>
        </>
      )}
    </li>
  );
}
