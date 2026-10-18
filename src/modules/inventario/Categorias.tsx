// Categorias do material (quem gere): criar, mudar o nome e arquivar (nunca apagar).
import { useState, type FormEvent } from 'react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Plus } from 'lucide-react';
import { Empty, ErrorBox, Field, Loading, MoreMenu, Notice, PageTitle } from '../../components/ui';
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
    if (r.ok) { setName(''); setAdding(false); }
  };
  const defaults = useAction();
  const [adding, setAdding] = useState(false);
  const existing = new Set((ov.data?.categories ?? []).map((c) => c.name.trim().toLowerCase()));
  const missing = DEFAULT_CATEGORIES.filter((n) => !existing.has(n.toLowerCase()));
  const manage = !!ov.data?.can_manage;
  return (
    <div className="inv-page">
      <PageTitle title="Tipos de material" back="/inventario"
        actions={manage ? (
          <>
            <button type="button" className="btn" aria-expanded={adding} onClick={() => { action.clear(); setErr(null); setAdding(!adding); }}>
              <Plus size={16} aria-hidden="true" /> Novo tipo
            </button>
            {missing.length > 0 && (
              <MoreMenu>
                <button type="button" className="btn" disabled={defaults.busy}
                  onClick={() => defaults.run(() => call<number>('inv_category_defaults', { p_section: section }), 'Tipos habituais criados.')}>
                  Criar categorias habituais
                </button>
              </MoreMenu>
            )}
          </>
        ) : undefined}
        info={<p>Os tipos organizam o material na lista e nos filtros. Tipos habituais: {DEFAULT_CATEGORIES.join(', ')}; «Criar categorias habituais» (no menu «Mais») só cria os que ainda não existem. Um tipo nunca se apaga: arquiva-se.</p>} />
      {ov.isLoading ? <Loading /> : ov.error ? <ErrorBox error={ov.error} /> : !manage ? (
        <Notice kind="info">Só os dirigentes e os responsáveis pelo material gerem as categorias.</Notice>
      ) : (
        <>
          <ErrorBox error={defaults.error} />
          {defaults.success && <Notice kind="success">{defaults.success}</Notice>}
          {!adding && action.success && <Notice kind="success">{action.success}</Notice>}
          {adding && (
            <form className="inv-form card flat inv-form-main" onSubmit={add} noValidate aria-label="Novo tipo">
              {err && <Notice kind="error">{err}</Notice>}
              <ErrorBox error={action.error} />
              <div className="row inv-add-row">
                <Field label="Novo tipo (configurável)" htmlFor="inv-cat-new">
                  <input id="inv-cat-new" type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Por exemplo: Cozinha" />
                </Field>
                <button type="submit" className="btn" disabled={action.busy}>Criar</button>
                <button type="button" className="btn secondary" onClick={() => setAdding(false)}>Cancelar</button>
              </div>
            </form>
          )}
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
  const [editing, setEditing] = useState(false);
  const save = async (archived: boolean) => {
    const r = await action.run(() => call('inv_category_save', { p_section: section, p_id: c.id, p_name: name, p_archived: archived }),
      archived === c.archived ? 'Categoria guardada.' : archived ? 'Categoria arquivada.' : 'Categoria reativada.');
    if (r.ok) setEditing(false);
  };
  return (
    <li className="inv-cat-row">
      {editing ? (
        <div className="row inv-cat-edit">
          <label className="sr-only" htmlFor={`cat-${c.id}`}>Nome da categoria</label>
          <input id={`cat-${c.id}`} type="text" className="grow" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <button type="button" className="btn" disabled={action.busy || !name.trim() || name.trim() === c.name} onClick={() => save(c.archived)}>Guardar nome</button>
          <button type="button" className="btn secondary" onClick={() => { setName(c.name); setEditing(false); }}>Cancelar</button>
        </div>
      ) : (
        <div className="row between inv-cat-view">
          <span className="inv-cat-name">
            <strong>{c.name}</strong>
            <span className="faint"> · {c.items} {c.items === 1 ? 'artigo' : 'artigos'}{c.archived ? ' · arquivada' : ''}</span>
          </span>
          <span className="row inv-cat-actions">
            <button type="button" className="btn ghost" onClick={() => { action.clear(); setEditing(true); }}>Mudar o nome</button>
            <button type="button" className="btn ghost" disabled={action.busy} onClick={() => save(!c.archived)}>{c.archived ? 'Reativar' : 'Arquivar'}</button>
          </span>
        </div>
      )}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
    </li>
  );
}
