// Categorias do material (quem gere): criar, mudar o nome e arquivar (nunca apagar).
import { useState, type FormEvent } from 'react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { InvTabs } from './parts';
import { DEFAULT_CATEGORIES, useOverview, useSectionId, type Category } from './api';

export function Categorias() {
  const ov = useOverview();
  const section = useSectionId();
  const action = useAction();
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr('Indica o nome da categoria.');
    const r = await action.run(() => call('inv_category_save', { p_section: section, p_id: null, p_name: name }), 'Categoria criada.');
    if (r.ok) setName('');
  };
  const defaults = useAction();
  const existing = new Set((ov.data?.categories ?? []).map((c) => c.name.trim().toLowerCase()));
  const missing = DEFAULT_CATEGORIES.filter((n) => !existing.has(n.toLowerCase()));
  return (
    <div className="inv-page">
      <PageTitle title="Tipos de material" subtitle="Categorias que organizam o material na lista e nos filtros." />
      <InvTabs />
      {ov.isLoading ? <Loading /> : ov.error ? <ErrorBox error={ov.error} /> : !ov.data!.can_manage ? (
        <Notice kind="info">Só os dirigentes e os responsáveis pelo material gerem as categorias.</Notice>
      ) : (
        <>
          {(missing.length > 0 || defaults.success) && (
            <div className="card inv-form-main">
              <p className="prose">Tipos habituais: {DEFAULT_CATEGORIES.join(', ')}. {missing.length > 0 ? `Faltam ${missing.length}: só se criam os que ainda não existem.` : ''}</p>
              <ErrorBox error={defaults.error} />
              {defaults.success && <Notice kind="success">{defaults.success}</Notice>}
              {missing.length > 0 && (
                <button type="button" className="btn secondary" disabled={defaults.busy}
                  onClick={() => defaults.run(() => call<number>('inv_category_defaults', { p_section: section }), 'Tipos habituais criados.')}>
                  Criar categorias habituais
                </button>
              )}
            </div>
          )}
          <form className="card inv-form-main" onSubmit={add} noValidate>
            {err && <Notice kind="error">{err}</Notice>}
            <ErrorBox error={action.error} />
            {action.success && <Notice kind="success">{action.success}</Notice>}
            <div className="row inv-add-row">
              <Field label="Novo tipo (configurável)" htmlFor="inv-cat-new">
                <input id="inv-cat-new" type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Por exemplo: Cozinha" />
              </Field>
              <button type="submit" className="btn" disabled={action.busy}>Criar</button>
            </div>
          </form>
          {ov.data!.categories.length === 0 ? <div className="card"><Empty title="Ainda não há tipos de material." /></div> : (
            <ul className="card list" aria-label="Categorias">
              {ov.data!.categories.map((c) => <CategoryRow key={c.id} c={c} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CategoryRow({ c }: { c: Category }) {
  const section = useSectionId();
  const action = useAction();
  const [name, setName] = useState(c.name);
  const save = (archived: boolean) => action.run(() => call('inv_category_save', { p_section: section, p_id: c.id, p_name: name, p_archived: archived }),
    archived === c.archived ? 'Categoria guardada.' : archived ? 'Categoria arquivada.' : 'Categoria reativada.');
  return (
    <li className="inv-cat-row">
      <div className="row">
        <label className="sr-only" htmlFor={`cat-${c.id}`}>Nome da categoria</label>
        <input id={`cat-${c.id}`} type="text" className="grow" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <span className="faint">{c.items} {c.items === 1 ? 'artigo' : 'artigos'}{c.archived ? ' · arquivada' : ''}</span>
      </div>
      <div className="btn-row">
        {name.trim() !== c.name && <button type="button" className="btn secondary" disabled={action.busy || !name.trim()} onClick={() => save(c.archived)}>Guardar nome</button>}
        <button type="button" className="btn ghost" disabled={action.busy} onClick={() => save(!c.archived)}>{c.archived ? 'Reativar' : 'Arquivar'}</button>
      </div>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
    </li>
  );
}
