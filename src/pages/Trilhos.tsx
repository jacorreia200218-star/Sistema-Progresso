import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronsDownUp, ChevronsUpDown, Search } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useProgress } from '../lib/hooks';
import { CATEGORY_LABEL, trailCategory } from '../lib/meuprogresso';
import type { CatalogArea, CatalogTrail } from '../lib/types';
import { PageTitle } from '../components/ui';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Realça as ocorrências da pesquisa (sem alterar o texto do manual). */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const n = norm(text);
  const out: ReactNode[] = [];
  let i = 0;
  for (let at = n.indexOf(q); at !== -1; at = n.indexOf(q, i)) {
    out.push(text.slice(i, at), <mark key={at}>{text.slice(at, at + q.length)}</mark>);
    i = at + q.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}

function trailMatches(t: CatalogTrail, a: CatalogArea, q: string) {
  if (!q) return true;
  return [a.name, a.full_name, t.name, t.framing, ...t.keywords, ...t.opportunities, ...t.catalog_objectives.flatMap((o) => [o.code, o.text])].some((x) => norm(x).includes(q));
}

/**
 * Resumo em árvore: as seis áreas FACEIS → os três trilhos de cada área →
 * objetivos educativos e palavras-chave. Tudo do catálogo verificado do manual.
 */
export default function Trilhos() {
  const s = useActiveSection();
  const { catalog } = s;
  const progress = useProgress(s.isMember ? s.membership.id : undefined);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const q = norm(query.trim());
  // Abrir/fechar tudo: muda a chave e os <details> recomeçam no estado pedido.
  const [all, setAll] = useState<{ open: boolean; n: number }>({ open: false, n: 0 });

  const tree = useMemo(
    () => catalog.areas.map((a) => ({ a, trails: a.catalog_trails.filter((t) => trailMatches(t, a, q)) })).filter((x) => x.trails.length),
    [catalog, q],
  );
  const total = catalog.areas.reduce((n, a) => n + a.catalog_trails.length, 0);
  const objectives = catalog.areas.reduce((n, a) => n + a.catalog_trails.reduce((m, t) => m + t.catalog_objectives.length, 0), 0);
  const found = tree.reduce((n, x) => n + x.trails.length, 0);
  const openAll = all.open || !!q;

  const setQuery = (v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set('q', v);
    else next.delete('q');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageTitle title="Trilhos" subtitle={`6 áreas FACEIS · ${total} trilhos · ${objectives} objetivos`} />

      <div className="tree-tools">
        <label className="search-field grow">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Procurar</span>
          <input type="search" placeholder="Procurar trilho, objetivo ou palavra-chave" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className="btn ghost" onClick={() => setAll({ open: !openAll, n: all.n + 1 })} disabled={!!q}>
          {openAll ? <ChevronsDownUp size={16} aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />}
          {openAll ? 'Fechar tudo' : 'Abrir tudo'}
        </button>
      </div>
      {q && <p className="faint" role="status">{found ? `${found} trilho(s) encontrado(s).` : 'Nada encontrado.'}</p>}

      <ul className="tree" aria-label="Áreas, trilhos e objetivos" key={`${all.n}-${q}`}>
        {tree.map(({ a, trails }) => (
          <li key={a.id}>
            <details open={openAll || undefined} className="tree-area">
              <summary>
                <span className="area-code" aria-hidden="true">{a.code}</span>
                <span className="grow"><strong><Hl text={a.name} q={q} /></strong> <span className="faint">· {a.dimension}</span></span>
                <span className="faint tree-count">{a.catalog_trails.length} trilhos</span>
              </summary>
              <ul>
                {trails.map((t) => {
                  const cat = progress.data ? trailCategory(t, progress.data) : null;
                  return (
                    <li key={t.id}>
                      <details open={!!q || undefined} className="tree-trail">
                        <summary>
                          <span className="grow"><Hl text={t.name} q={q} /></span>
                          {cat && cat !== 'por_fechar' && <span className={`tree-state t-${CATEGORY_LABEL[cat].tone}`}>{CATEGORY_LABEL[cat].label}</span>}
                          <span className="faint tree-count">{t.catalog_objectives.map((o) => o.code).join(' ')}</span>
                        </summary>
                        <div className="tree-body">
                          <p className="faint prose"><Hl text={t.framing} q={q} /></p>
                          <ul className="tree-objectives">
                            {t.catalog_objectives.map((o) => (
                              <li key={o.id}><span className="obj-code">{o.code}</span> <span className="prose"><Hl text={o.text} q={q} /></span></li>
                            ))}
                          </ul>
                          {t.keywords.length > 0 && (
                            <p className="tree-keywords">{t.keywords.map((k, i) => <span key={k}>{i > 0 && ' · '}<Hl text={k} q={q} /></span>)}</p>
                          )}
                          {t.opportunities.length > 0 && (
                            <details className="more-inner">
                              <summary>Ver exemplos</summary>
                              <ul className="tight">{t.opportunities.map((o, i) => <li key={i}><Hl text={o} q={q} /></li>)}</ul>
                            </details>
                          )}
                          {(s.isMember || s.isDirigente) && (
                            <Link to={`/meu-progresso/trilho/${t.key}`} className="tree-link">Abrir o trilho →</Link>
                          )}
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        ))}
      </ul>

    </>
  );
}
