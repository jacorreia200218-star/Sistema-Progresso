// «Meu progresso»: começa pelas seis áreas FACEIS (área → trilho → objetivos →
// justificação → enviar). O percurso das etapas, os pedidos e o progresso
// validado ficam em acessos secundários.
// Dirigentes (sem percurso próprio) começam numa grelha de pioneiros; ao escolher
// uma pessoa, consultam o seu progresso com um único cabeçalho de consulta. Os
// guias podem fazer o mesmo com a sua equipa. A autorização vem do servidor.
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, Route as RouteIcon, Users } from 'lucide-react';
import { useSubject } from '../components/meu/useSubject';
import { CaminhoView } from '../components/meu/CaminhoView';
import { AreasView } from '../components/meu/AreasView';
import { PedidosView } from '../components/meu/PedidosView';
import { ValidadoView } from '../components/meu/ValidadoView';
import { ConsultHeader, gridHref } from '../components/meu/ConsultHeader';
import { PessoasGrid } from '../components/meu/PessoasGrid';
import { trailCategory } from '../lib/meuprogresso';
import { ErrorBox, Loading, PageTitle } from '../components/ui';
import { Crumbs, type Crumb } from '../components/nav';

const VIEWS = [
  { key: 'areas', label: 'Áreas FACEIS' },
  { key: 'pedidos', label: 'Os meus pedidos', consult: 'Pedidos' },
  { key: 'validado', label: 'Progresso validado' },
  { key: 'caminho', label: 'O meu percurso', consult: 'Percurso' },
  { key: 'pessoas', label: 'Pioneiros' },
] as const;

export default function MeuProgresso() {
  const subject = useSubject();
  const [params] = useSearchParams();
  const canConsult = subject.isDirigente || subject.isGuia;
  const requested = (VIEWS.find((v) => v.key === params.get('vista'))?.key ?? 'areas') as (typeof VIEWS)[number]['key'];
  // Dirigentes sem pessoa escolhida (ou quem pede a lista) veem a grelha de pioneiros.
  const showGrid = canConsult && !subject.consulted && (requested === 'pessoas' || !subject.isMember);
  const vista = showGrid ? 'pessoas' : requested === 'pessoas' ? 'areas' : requested;
  const viewLabel = (k: string) => {
    const v = VIEWS.find((x) => x.key === k)!;
    return subject.consulted && 'consult' in v ? v.consult : v.label;
  };

  const viewTo = (k: string) => `?vista=${k}${subject.q ? `&${subject.q}` : ''}`;
  const p = subject.progress.data;
  const needsAction = p ? p.requests.filter((r) => r.status === 'rascunho' || r.status === 'devolvido').length : 0;
  const title = subject.consulted ? `Progresso de ${subject.consulted.full_name.split(' ')[0]}` : subject.isMember && !showGrid ? 'Meu progresso' : 'Progresso dos pioneiros';

  const area = vista === 'areas' ? subject.catalog.areas.find((a) => a.code === params.get('area')) : undefined;
  const progressTo = `/meu-progresso${viewTo('areas')}`;
  const crumbs: Crumb[] = [{ label: 'Início', to: '/' }];
  if (subject.consulted && !subject.isMember) crumbs.push({ label: 'Pioneiros', to: gridHref() });
  crumbs.push({ label: subject.consulted ? title : showGrid ? title : 'Progresso', to: progressTo });
  if (area) crumbs.push({ label: area.name });
  else if (vista !== 'areas' && vista !== 'pessoas') crumbs.push({ label: viewLabel(vista) });
  const validatedTrails = p ? subject.catalog.areas.flatMap((a) => a.catalog_trails).filter((t) => trailCategory(t, p) === 'validado').length : 0;

  return (
    <>
      <Crumbs items={crumbs} />
      <PageTitle title={area ? area.name : vista === 'areas' || vista === 'pessoas' ? title : viewLabel(vista)} />
      <ConsultHeader subject={subject} />

      {vista === 'pessoas' ? (
        subject.pathLoading ? <Loading rows={2} /> : <PessoasGrid subject={subject} />
      ) : !subject.subjectId ? (
        subject.pathLoading ? <Loading rows={2} /> : null
      ) : (
        <>
          {vista !== 'areas' && (
            <Link to={viewTo('areas')} className="btn ghost back-areas"><ArrowLeft size={16} aria-hidden="true" /> Voltar às áreas</Link>
          )}
          <div id="vista-painel">
            {subject.progress.isLoading ? <Loading /> : subject.progress.error || !p ? (
              <ErrorBox error={subject.progress.error ?? 'Sem acesso a este percurso.'} retry={subject.progress.refetch} />
            ) : vista === 'caminho' ? (
              <CaminhoView subject={subject} progress={p} />
            ) : vista === 'areas' ? (
              <AreasView subject={subject} progress={p} />
            ) : vista === 'validado' ? (
              <ValidadoView subject={subject} progress={p} />
            ) : (
              <PedidosView subject={subject} progress={p} />
            )}
          </div>
          {vista === 'areas' && !area && (
            <nav className="progress-links" aria-label="Mais sobre o progresso">
              {!subject.consulted && <Link to={viewTo('pedidos')} className="btn secondary">
                <ClipboardList size={16} aria-hidden="true" /> {viewLabel('pedidos')}
                {needsAction > 0 && <span className="count" aria-label={`${needsAction} precisam de atenção`}>{needsAction}</span>}
              </Link>}
              <Link to={viewTo('validado')} className="btn secondary">
                <CheckCircle2 size={16} aria-hidden="true" /> Progresso validado{p ? <span className="faint">&nbsp;· {validatedTrails}</span> : null}
              </Link>
              {/* Na consulta, Pedidos e Percurso estão no cabeçalho (sem acessos repetidos). */}
              {!subject.consulted && <Link to={viewTo('caminho')} className="btn ghost"><RouteIcon size={16} aria-hidden="true" /> Ver o meu percurso</Link>}
              {subject.isGuia && !subject.consulted && (
                <Link to="?vista=pessoas" className="btn ghost"><Users size={16} aria-hidden="true" /> Progresso da equipa</Link>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
