import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Lightbulb } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useProgress } from '../lib/hooks';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { activeRequest, openPath, trailState } from '../lib/progress';
import { requestStatusLabel, trailStateLabel } from '../lib/labels';
import { Badge, ConfirmButton, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import { stageName } from '../components/StagePanel';
import NotFound from './NotFound';

export default function TrailDetail() {
  const { key } = useParams();
  const s = useActiveSection();
  const { catalog, membership, isMember, settings } = s;
  const trail = key ? catalog.trailByKey.get(key) : undefined;
  const q = useProgress(isMember ? membership.id : undefined);
  const action = useAction();
  const navigate = useNavigate();
  const [planned, setPlanned] = useState('');

  if (!trail) return <NotFound />;
  const area = catalog.areaById.get(trail.area_id)!;
  if (isMember && q.isLoading) return <Loading />;

  const p = q.data;
  const st = p ? trailState(trail, p) : null;
  const path = p ? openPath(p.paths) : undefined;
  const choiceHere = p?.choices.find((c) => c.trail_key === trail.key && (c.status === 'confirmada' || c.status === 'proposta'));
  const areaConfirmed = p && path ? p.choices.find((c) => c.stage_path_id === path.id && c.area_code === area.code && c.status === 'confirmada') : undefined;
  const areaProposed = p && path ? p.choices.find((c) => c.stage_path_id === path.id && c.area_code === area.code && c.status === 'proposta') : undefined;
  const request = p ? activeRequest(p.requests, trail.key) : undefined;
  const pathBusy = !!(p && path && p.stageRequests.some((r) => r.stage_path_id === path.id && (r.status === 'submetido' || r.status === 'decidido_conselho')));
  const canPropose = isMember && path && !choiceHere && !areaProposed && !pathBusy;

  async function propose(replaces: string | null) {
    const res = await action.run(
      () => call('propose_choice', { p_stage_path: path!.id, p_trail: trail!.id, p_planned: planned, p_replaces: replaces }),
      replaces ? 'Proposta de troca enviada à Equipa de Animação.' : 'Proposta enviada à Equipa de Animação.',
    );
    if (res.ok) setPlanned('');
  }

  async function createRequest(kind: 'normal' | 'historico') {
    const res = await action.run(() => call<string>('create_trail_request', { p_membership: membership.id, p_trail: trail!.id, p_kind: kind }));
    if (res.ok && res.value) navigate(`/pedidos/${res.value}`);
  }

  return (
    <>
      <PageTitle title={trail.name} subtitle={`${area.full_name} · Dimensão: ${area.dimension}`} back={true} />
      {st && (
        <div className="row" style={{ marginBottom: 12 }}>
          <Badge {...trailStateLabel[st.state]} />
          {request && request.kind === 'historico' && <Badge label="Progresso anterior" tone="neutral" icon="clock" />}
        </div>
      )}

      <section className="card">
        <h2>Enquadramento</h2>
        <p style={{ whiteSpace: 'pre-line' }}>{trail.framing}</p>
        {trail.pending_note && (
          <Notice kind="warn">
            <p><strong>Ponto pendente de confirmação.</strong> {trail.pending_note}</p>
          </Notice>
        )}
        <div className="chips" aria-label="Palavras-chave">
          {trail.keywords.map((k) => <span key={k} className="chip">{k}</span>)}
        </div>
      </section>

      <section className="card">
        <h2>Objetivos educativos</h2>
        <p className="faint">São a orientação para o teu crescimento. A validação é do trilho como um todo.</p>
        {trail.catalog_objectives.map((o) => (
          <div key={o.id} className="objective">
            <span className="code">{o.code}</span>
            <div>
              <p style={{ margin: 0 }}>{o.text}</p>
              {o.pending_note && (
                <p className="faint" style={{ margin: '4px 0 0' }}>
                  <AlertTriangle size={14} aria-hidden="true" /> Pendente: {o.pending_note}
                </p>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="card-title">
          <Lightbulb aria-hidden="true" color="var(--green-ink)" />
          <h2 style={{ margin: 0 }}>Oportunidades educativas</h2>
        </div>
        <p className="faint">Sugestões do manual — exemplos, não uma lista fechada. São meios para crescer; realizá-las não valida o trilho por si.</p>
        <ul>
          {trail.opportunities.map((o, i) => <li key={i} style={{ marginBottom: 6 }}>{o}</li>)}
        </ul>
      </section>

      {isMember && p && (
        <section className="card">
          <h2>O meu caminho neste trilho</h2>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}

          {choiceHere && (
            <p>
              {choiceHere.status === 'confirmada' ? 'Confirmado' : 'Proposto'} para a etapa{' '}
              <strong>{stageName(catalog, p.paths.find((x) => x.id === choiceHere.stage_path_id)?.stage_key ?? '')}</strong>.
              {choiceHere.planned_opportunities && (
                <>
                  <br />
                  <span className="faint">Oportunidades previstas: {choiceHere.planned_opportunities}</span>
                </>
              )}
            </p>
          )}
          {choiceHere?.status === 'proposta' && (
            <button type="button" className="btn secondary" disabled={action.busy}
              onClick={() => action.run(() => call('withdraw_choice', { p_choice: choiceHere.id }), 'Proposta retirada.')}>
              Retirar proposta
            </button>
          )}

          {canPropose && (
            <div className="stack" style={{ marginTop: 8 }}>
              <Field
                label={areaConfirmed ? `Propor troca na etapa ${stageName(catalog, path!.stage_key)}` : `Propor para a etapa ${stageName(catalog, path!.stage_key)}`}
                htmlFor="planned"
                hint="Que oportunidades educativas pensas viver? O manual sugere pelo menos duas por trilho — é uma orientação, não um mínimo."
              >
                <textarea id="planned" aria-describedby="planned-hint" value={planned} onChange={(e) => setPlanned(e.target.value)} />
              </Field>
              {areaConfirmed && (
                <p className="faint">
                  Já tens «{catalog.trailById.get(areaConfirmed.trail_id)?.name}» confirmado nesta área. A troca é negociada com a Equipa de Animação e fica no histórico.
                </p>
              )}
              <button type="button" className="btn" disabled={action.busy} onClick={() => propose(areaConfirmed?.id ?? null)}>
                {areaConfirmed ? 'Propor troca' : 'Propor este trilho'}
              </button>
            </div>
          )}
          {isMember && path && areaProposed && !choiceHere && (
            <p className="faint">Já tens uma proposta pendente nesta área.</p>
          )}

          <div className="btn-row">
            {request ? (
              <Link to={`/pedidos/${request.id}`} className="btn secondary">
                Ver pedido <Badge {...requestStatusLabel[request.status]} />
              </Link>
            ) : (
              <>
                <ConfirmButton
                  className="btn"
                  confirmLabel="Criar rascunho"
                  description="Vais escrever a tua reflexão e as vivências. Só é enviado quando submeteres."
                  disabled={action.busy}
                  onConfirm={() => createRequest('normal')}
                >
                  Pedir validação
                </ConfirmButton>
                {settings?.historical_progress_enabled && (
                  <ConfirmButton
                    confirmLabel="Criar pedido de progresso anterior"
                    description="Para trilhos que já concluíste antes de usar a aplicação. Segue diretamente para os dirigentes."
                    disabled={action.busy}
                    onConfirm={() => createRequest('historico')}
                  >
                    Já concluí antes
                  </ConfirmButton>
                )}
              </>
            )}
          </div>
        </section>
      )}
      <p className="faint">Fonte: Manual do Dirigente, p. {trail.source_page}.</p>
    </>
  );
}
