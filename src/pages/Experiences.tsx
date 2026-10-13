import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useActiveSection } from '../lib/session';
import { fetchExperiences } from '../lib/api';
import { useAction } from '../lib/useAction';
import { errorMessage } from '../lib/errors';
import { formatDate, todayIso } from '../lib/labels';
import { ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';

/** Diário pessoal de vivências: só o próprio vê. Registar uma vivência não valida nada. */
export default function Experiences() {
  const { membership, catalog } = useActiveSection();
  const q = useQuery({ queryKey: ['experiences', membership.id], queryFn: () => fetchExperiences(membership.id) });
  const action = useAction();
  const [form, setForm] = useState({ title: '', description: '', occurred_on: '', trail_key: '' });

  async function add(e: FormEvent) {
    e.preventDefault();
    const res = await action.run(async () => {
      const { error } = await supabase.from('experiences').insert({
        membership_id: membership.id,
        title: form.title.trim(),
        description: form.description,
        occurred_on: form.occurred_on || null,
        trail_key: form.trail_key || null,
      });
      if (error) throw new Error(errorMessage(error));
    }, 'Vivência guardada.');
    if (res.ok) setForm({ title: '', description: '', occurred_on: '', trail_key: '' });
  }

  return (
    <>
      <PageTitle title="Vivências" subtitle="O teu diário de oportunidades educativas. Só tu o vês; usa-o para preparar os pedidos." back="/progresso" />
      <form className="card" onSubmit={add}>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <Field label="O que viveste?" htmlFor="title">
          <input id="title" type="text" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Descrição (opcional)" htmlFor="desc">
          <textarea id="desc" value={form.description} maxLength={4000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className="grid-2">
          <Field label="Data (opcional)" htmlFor="date">
            <input id="date" type="date" max={todayIso()} value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} />
          </Field>
          <Field label="Trilho relacionado (opcional)" htmlFor="trail">
            <select id="trail" value={form.trail_key} onChange={(e) => setForm({ ...form, trail_key: e.target.value })}>
              <option value="">—</option>
              {catalog.areas.map((a) => (
                <optgroup key={a.id} label={a.name}>
                  {a.catalog_trails.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>
        <button className="btn" disabled={action.busy || !form.title.trim()}>Guardar vivência</button>
      </form>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <div className="card">
          {!q.data?.length ? <Empty title="Ainda não registaste vivências." /> : (
            <ul className="list">
              {q.data.map((x) => (
                <li key={x.id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <span className="grow">
                    <strong>{x.title}</strong>
                    <br />
                    <span className="faint">
                      {x.occurred_on ? formatDate(x.occurred_on) : 'Sem data'}
                      {x.trail_key ? ` · ${catalog.trailByKey.get(x.trail_key)?.name ?? ''}` : ''}
                    </span>
                    {x.description && <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{x.description}</p>}
                  </span>
                  <ConfirmButton className="btn ghost" confirmLabel="Apagar" disabled={action.busy}
                    onConfirm={() => action.run(async () => {
                      const { error } = await supabase.from('experiences').delete().eq('id', x.id);
                      if (error) throw new Error(errorMessage(error));
                    }, 'Vivência apagada.')}>
                    <Trash2 size={18} aria-label="Apagar" />
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
