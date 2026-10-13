import { Link } from 'react-router-dom';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { memberPosition, MILESTONES, milestoneByKey, STATE_LABEL } from '../../lib/caminho';
import { nextAction } from '../../lib/progress';
import { progressCounts, stageChecklist } from '../../lib/meuprogresso';
import { formatDate } from '../../lib/labels';
import type { MemberProgress } from '../../lib/types';
import { ConfirmButton, ErrorBox, Notice } from '../ui';
import { Track } from '../caminho/Track';
import { PersonalAtMilestone } from '../caminho/Pieces';
import { MilestoneInfo, personalSteps } from '../caminho/Shared';
import { FaceisSummary } from '../caminho/Faceis';
import type { Subject } from './useSubject';

/**
 * Resumo único do percurso: etapa atual, histórico reconhecido, as seis áreas e
 * o próximo passo. O mapa e as explicações só aparecem quando se abrem.
 */
export function CaminhoView({ subject, progress }: { subject: Subject; progress: MemberProgress }) {
  const { catalog } = subject;
  const action = useAction();
  const pos = memberPosition(progress, catalog);
  const counts = progressCounts(catalog, progress);
  const check = stageChecklist(catalog, progress);
  const stageOpen = !!check && check.summary.path.status === 'em_curso';
  const next = nextAction(catalog, progress, subject.isSelf ? { kind: 'self' } : { kind: subject.isDirigente ? 'dirigente' : subject.isGuia ? 'guia' : 'outro', membershipId: subject.subjectId! });
  const trailHref = (key: string) => `/meu-progresso/trilho/${key}${subject.q ? `?${subject.q}` : ''}`;
  const canRequest = stageOpen && check!.stageValidation === 'por_pedir' && (subject.isSelf || subject.isDirigente || subject.isGuia);
  const path = check?.summary.path;
  const stageValidation = check && {
    por_pedir: 'Por pedir ao Conselho de Guias',
    nao_disponivel: 'Depois de um trilho validado em cada área',
    conselho: 'Aguarda o Conselho de Guias',
    opiniao_final: 'Aguarda a opinião final da Equipa de Animação',
    validada: `Validada${path?.completed_on ? ` em ${formatDate(path.completed_on)}` : ''}`,
  }[check.stageValidation];

  return (
    <div className="caminho-page">
      <section className="card summary" aria-label="Resumo do percurso">
        <div className="summary-cols">
          <div>
            <h2>Etapa atual</h2>
            <p className="summary-main">{counts.stage ? counts.stage.name : milestoneByKey[pos.milestone].name}</p>
            <p className="faint prose">
              {STATE_LABEL[pos.state].label}
              {counts.stage && ` · ${counts.stage.validated} de ${counts.stage.areas} áreas com trilho validado nesta etapa`}
            </p>
            {stageOpen && path && <p className="faint">Insígnia: {path.insignia_delivered_on ? formatDate(path.insignia_delivered_on) : 'Por registar'}</p>}
          </div>
          <div>
            <h2>Histórico reconhecido</h2>
            <p className="summary-main">{counts.validated} {counts.validated === 1 ? 'trilho validado' : 'trilhos validados'}</p>
            <p className="faint prose">
              Em todas as etapas{counts.recognized > 0 ? `; ${counts.recognized} de progresso anterior ou reconhecidos na negociação` : ''}.
            </p>
            {stageOpen && counts.unassigned.length > 0 && (
              <p className="faint prose">
                {counts.unassigned.length === 1 ? '1 trilho validado ainda não está associado' : `${counts.unassigned.length} trilhos validados ainda não estão associados`} a
                nenhuma etapa. Só conta{counts.unassigned.length === 1 ? '' : 'm'} para a etapa atual depois de confirmado{counts.unassigned.length === 1 ? '' : 's'} na negociação com a Equipa de Animação.
              </p>
            )}
          </div>
        </div>

        <h3 className="summary-sub">Áreas FACEIS{stageOpen ? ' nesta etapa' : ''}</h3>
        <FaceisSummary catalog={catalog} progress={progress} trailHref={trailHref} />

        {check && (
          <dl className="meta compact-meta">
            <dt>Validação da etapa</dt>
            <dd>{stageValidation}</dd>
            {check.stageValidation === 'validada' && (
              <>
                <dt>Reconhecimento</dt>
                <dd>{path?.recognized_on ? `Realizado em ${formatDate(path.recognized_on)}` : 'Pendente (na celebração)'}</dd>
              </>
            )}
          </dl>
        )}

        <div className="next-line">
          <span className="faint">{subject.isSelf ? 'Próximo passo' : 'Próximo passo do pioneiro'}</span>
          <p style={{ margin: 0 }}><strong>{next.title}</strong></p>
          {next.detail && <p className="faint prose" style={{ margin: '2px 0 0' }}>{next.detail}</p>}
          {next.to && next.label && !next.to.startsWith('/meu-progresso?vista=caminho') && <Link to={next.to} className="btn" style={{ marginTop: 6 }}>{next.label}</Link>}
        </div>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        {canRequest && !action.success && (
          <ConfirmButton className="btn" confirmLabel="Pedir validação da etapa" description="O pedido segue para o Conselho de Guias; a etapa só fica concluída depois da opinião final da Equipa de Animação."
            disabled={action.busy}
            onConfirm={() => action.run(() => call('request_stage_validation', { p_stage_path: path!.id }), 'Pedido de validação da etapa enviado ao Conselho de Guias.')}>
            Pedir validação da etapa
          </ConfirmButton>
        )}
      </section>

      <details className="more">
        <summary>Ver o mapa do caminho</summary>
        <Track steps={personalSteps(progress, catalog, subject.isSelf)} label="Marcos do caminho" />
        {MILESTONES.filter((m) => m.tracked).map((m) => (
          <details key={m.key} className="more-inner" open={m.key === pos.milestone}>
            <summary>{m.name}</summary>
            <PersonalAtMilestone k={m.key} progress={progress} catalog={catalog} self={subject.isSelf} />
            <details className="more-inner">
              <summary>Explicação do manual</summary>
              <MilestoneInfo k={m.key} />
            </details>
          </details>
        ))}
      </details>
    </div>
  );
}
