// «Meu progresso»: o local central do pioneiro, com três vistas ligadas entre
// si e os mesmos dados — Caminho, Áreas FACEIS e Pedidos.
// Dirigentes (sem percurso próprio) e guias podem consultar, em modo de consulta
// claramente identificado, o progresso de um pioneiro que já estão autorizados a ver.
import { Link, useSearchParams } from 'react-router-dom';
import { Eye, X } from 'lucide-react';
import { useSubject } from '../components/meu/useSubject';
import { CaminhoView } from '../components/meu/CaminhoView';
import { AreasView } from '../components/meu/AreasView';
import { PedidosView } from '../components/meu/PedidosView';
import { ErrorBox, Loading, PageTitle } from '../components/ui';
import { Crumbs, type Crumb } from '../components/nav';

const VIEWS = [
  { key: 'caminho', label: 'Caminho' },
  { key: 'areas', label: 'Áreas FACEIS' },
  { key: 'pedidos', label: 'Pedidos' },
] as const;

export default function MeuProgresso() {
  const subject = useSubject();
  const [params, setParams] = useSearchParams();
  const vista = (VIEWS.find((v) => v.key === params.get('vista'))?.key ?? 'caminho') as (typeof VIEWS)[number]['key'];
  const canConsult = subject.isDirigente || subject.isGuia;

  const setView = (k: string) => {
    const next = new URLSearchParams();
    next.set('vista', k);
    if (subject.consulted) next.set('pioneiro', subject.consulted.membership_id);
    setParams(next);
  };
  const setSubject = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set('pioneiro', id);
    else next.delete('pioneiro');
    next.delete('area');
    next.delete('marco');
    setParams(next);
  };

  const p = subject.progress.data;
  const needsAction = p ? p.requests.filter((r) => r.status === 'rascunho' || r.status === 'devolvido').length : 0;
  const title = subject.consulted ? `Progresso de ${subject.consulted.full_name.split(' ')[0]}` : subject.isMember ? 'Meu progresso' : 'Progresso dos pioneiros';

  const area = vista === 'areas' ? subject.catalog.areas.find((a) => a.code === params.get('area')) : undefined;
  const progressTo = `/meu-progresso?vista=${vista}${subject.q ? `&${subject.q}` : ''}`;
  const crumbs: Crumb[] = [{ label: 'Início', to: '/' }, { label: subject.consulted ? title : 'Progresso', to: progressTo }];
  if (area) crumbs.push({ label: area.name });

  return (
    <>
      <Crumbs items={crumbs} />
      <PageTitle title={area ? `${title} · ${area.name}` : title} />

      {canConsult && (
        <div className={`consult-bar ${subject.consulted ? 'active' : ''}`}>
          <Eye size={18} aria-hidden="true" />
          <label className="inline-field grow">
            <span>{subject.isMember ? 'Consultar outro pioneiro' : 'Consultar o progresso de'}</span>
            <select value={subject.consulted?.membership_id ?? ''} onChange={(e) => setSubject(e.target.value)}>
              <option value="">{subject.isMember ? 'O meu progresso' : 'Escolhe um pioneiro…'}</option>
              {subject.authorized.map((m) => <option key={m.membership_id} value={m.membership_id}>{m.full_name}</option>)}
            </select>
          </label>
          {subject.consulted && (
            <button type="button" className="btn ghost icon-btn" aria-label="Sair do modo de consulta" onClick={() => setSubject('')}><X size={18} aria-hidden="true" /></button>
          )}
        </div>
      )}
      {subject.consulted && (
        <p className="consult-note prose" role="note">
          <strong>Modo de consulta</strong> · {subject.consulted.full_name}. As ações do pioneiro não estão disponíveis.
          {subject.isDirigente && <> Decisões: <Link to={`/membros/${subject.consulted.membership_id}`}>percurso do membro</Link>.</>}
        </p>
      )}

      {!subject.subjectId ? (
        subject.pathLoading ? <Loading rows={2} /> : (
          <div className="card">
            <p className="prose">Os dirigentes não têm percurso pessoal na aplicação. Escolhe acima um pioneiro para consultar o seu progresso.</p>
            {subject.authorized.length === 0 && <p className="faint">Ainda não há pioneiros ativos na secção.</p>}
          </div>
        )
      ) : (
        <>
          <div className="tabs view-tabs" role="tablist" aria-label="Vistas do progresso">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" id={`tab-${v.key}`} aria-controls="vista-painel" className="tab"
                aria-selected={vista === v.key} onClick={() => setView(v.key)}>
                {v.label}
                {v.key === 'pedidos' && needsAction > 0 && <span className="count" aria-label={`${needsAction} precisam de atenção`}>{needsAction}</span>}
              </button>
            ))}
          </div>
          <div id="vista-painel" role="tabpanel" aria-labelledby={`tab-${vista}`}>
            {subject.progress.isLoading ? <Loading /> : subject.progress.error || !p ? (
              <ErrorBox error={subject.progress.error ?? 'Sem acesso a este percurso.'} retry={subject.progress.refetch} />
            ) : vista === 'caminho' ? (
              <CaminhoView subject={subject} progress={p} />
            ) : vista === 'areas' ? (
              <AreasView subject={subject} progress={p} />
            ) : (
              <PedidosView subject={subject} progress={p} />
            )}
          </div>
        </>
      )}
    </>
  );
}
