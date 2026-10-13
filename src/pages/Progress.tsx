import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen, History, NotebookPen } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useProgress } from '../lib/hooks';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { focusPath, stageSummary, trailState, validatedKeys } from '../lib/progress';
import { formatDate, stageRequestLabel, trailStateLabel } from '../lib/labels';
import { Badge, ConfirmButton, ErrorBox, Loading, Meter, Notice, PageTitle } from '../components/ui';
import { MeritCard, StagePanel, stageName } from '../components/StagePanel';

export default function Progress() {
  const { membership, catalog, settings } = useActiveSection();
  const q = useProgress(membership.id);
  const action = useAction();
  const location = useLocation();

  useEffect(() => {
    if (location.hash && q.data) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash, q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const p = q.data;
  const path = focusPath(p.paths);
  const summary = path ? stageSummary(path, catalog, p) : null;
  const previous = p.paths.filter((x) => x.id !== path?.id).sort((a, b) => a.stage_ordinal - b.stage_ordinal);
  const valid = validatedKeys(p.requests);
  const hasHistoric = p.requests.some((r) => r.kind === 'historico');

  return (
    <>
      <PageTitle title="Progresso" subtitle="O teu caminho na secção e o percurso da etapa." />

      <h2 className="section-title">Percurso da etapa</h2>
      {!p.adhesion && (
        <Notice kind="info">
          <p>Estás na etapa do Desprendimento (adesão). A Equipa de Animação regista a tua adesão e abre contigo a primeira etapa.</p>
        </Notice>
      )}
      {p.adhesion && !path && <Notice kind="info"><p>Adesão registada em {formatDate(p.adhesion.decided_on)}. A próxima etapa ainda não foi aberta.</p></Notice>}
      {summary && (
        <>
          <StagePanel summary={summary} catalog={catalog} />
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          {summary.ready && (
            <div className="card flat">
              <p>Tens um trilho validado em cada área desta etapa. A validação da etapa é decidida pelo Conselho de Guias, com a opinião final da Equipa de Animação.</p>
              <ConfirmButton
                className="btn"
                confirmLabel="Sim, pedir validação"
                description="O pedido segue para o Conselho de Guias."
                disabled={action.busy}
                onConfirm={() => action.run(() => call('request_stage_validation', { p_stage_path: summary.path.id }), 'Pedido de validação da etapa enviado.')}
              >
                Pedir validação da etapa
              </ConfirmButton>
            </div>
          )}
          {summary.lastRequest && summary.lastRequest.status === 'nao_confirmada' && !summary.openRequest && (
            <Notice kind="warn">
              <p>
                A última validação da etapa não foi confirmada{summary.lastRequest.final_comment ? `: «${summary.lastRequest.final_comment}»` : '.'}
              </p>
            </Notice>
          )}
          {summary.openRequest && (
            <Notice kind="info">
              <p>
                <Badge {...stageRequestLabel[summary.openRequest.status]} /> A etapa só fica concluída depois da opinião final da Equipa de Animação.
              </p>
            </Notice>
          )}
        </>
      )}
      {previous.length > 0 && (
        <details className="card flat">
          <summary>Etapas anteriores ({previous.length})</summary>
          <ul className="list">
            {previous.map((x) => (
              <li key={x.id} className="list-item">
                <span className="grow">{stageName(catalog, x.stage_key)}</span>
                {x.status === 'concluida' ? <Badge label={`Concluída ${formatDate(x.completed_on)}`} tone="ok" icon="check" /> : <Badge label="Em curso" tone="progress" icon="compass" />}
              </li>
            ))}
          </ul>
        </details>
      )}
      <MeritCard progress={p} catalog={catalog} />

      <h2 className="section-title">Progresso global</h2>
      <div className="card">
        <Meter value={valid.size} max={catalog.trailById.size} label="Trilhos validados" />
        <p className="faint" style={{ marginTop: 8 }}>
          Concluir uma atividade ou enviar uma fotografia não valida um trilho: a validação é feita na reunião de Equipa, a partir da tua reflexão e do caminho percorrido.
        </p>
        <div className="btn-row">
          <Link to="/vivencias" className="btn secondary"><NotebookPen size={18} aria-hidden="true" /> Vivências</Link>
          {(settings?.historical_progress_enabled || hasHistoric) && (
            <Link to="/progresso-anterior" className="btn secondary"><History size={18} aria-hidden="true" /> Progresso anterior</Link>
          )}
        </div>
      </div>

      {catalog.areas.map((area) => (
        <section key={area.id} id={`area-${area.code}`} className="card" aria-labelledby={`h-${area.code}`}>
          <div className="area-head" style={{ marginBottom: 6 }}>
            <span className="area-code" aria-hidden="true">{area.code}</span>
            <div>
              <h2 id={`h-${area.code}`} style={{ margin: 0 }}>{area.name}</h2>
              <span className="faint">Dimensão da personalidade: {area.dimension}</span>
            </div>
          </div>
          <ul className="list">
            {area.catalog_trails.map((t) => {
              const st = trailState(t, p);
              return (
                <li key={t.id}>
                  <Link to={`/progresso/trilho/${t.key}`} className="list-item">
                    <BookOpen size={20} aria-hidden="true" color="var(--ink-faint)" />
                    <span className="grow">
                      <strong>{t.name}</strong>
                      <br />
                      <span className="faint">
                        {t.catalog_objectives.map((o) => o.code).join(' · ')}
                        {st.request?.kind === 'historico' ? ' · progresso anterior' : ''}
                      </span>
                    </span>
                    <Badge {...trailStateLabel[st.state]} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="faint">Catálogo: {catalog.label}.</p>
    </>
  );
}
