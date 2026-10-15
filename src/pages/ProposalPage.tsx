// Registo de uma proposta de trilho (negociação): cada proposta tem a sua página,
// com identificador, estado, datas, decisão e a ligação às propostas que substitui
// ou que a substituíram. Propostas diferentes nunca aparecem como uma só.
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { useMembers, useTeams } from '../lib/hooks';
import { fetchSectionChoices, fetchSectionStagePaths } from '../lib/api';
import { formatDateTime, proposalRef } from '../lib/labels';
import { Avatar, Badge, ErrorBox, Loading, PageTitle } from '../components/ui';
import { stageName } from '../components/StagePanel';
import { CHOICE_STATUS, ChoiceDecision } from './Leaders';
import NotFound from './NotFound';

export default function ProposalPage() {
  const { id } = useParams();
  const { membership, catalog } = useActiveSection();
  const members = useMembers(membership.section_id);
  const teams = useTeams(membership.section_id);
  const ids = (members.data ?? []).map((m) => m.id);
  const choices = useQuery({ queryKey: ['choices', ids, 'todas'], queryFn: () => fetchSectionChoices(ids), enabled: ids.length > 0 });
  const paths = useQuery({ queryKey: ['paths', ids], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });

  if (members.isLoading || choices.isLoading) return <Loading />;
  if (members.error || choices.error) return <ErrorBox error={members.error ?? choices.error} retry={() => { members.refetch(); choices.refetch(); }} />;
  const all = choices.data ?? [];
  const c = all.find((x) => x.id === id);
  if (!c) return <NotFound />;

  const member = members.data?.find((m) => m.id === c.membership_id);
  const nameOf = (profileId: string | null) => (profileId ? members.data?.find((m) => m.profile_id === profileId)?.profiles?.full_name : undefined);
  const team = teams.data?.find((t) => t.id === member?.team_id)?.name;
  const trail = catalog.trailById.get(c.trail_id);
  const area = trail ? catalog.areaById.get(trail.area_id) : undefined;
  const stage = stageName(catalog, paths.data?.find((p) => p.id === c.stage_path_id)?.stage_key ?? '');
  const st = CHOICE_STATUS[c.status];
  const replaces = all.find((x) => x.id === c.replaces_choice_id);
  const replacedBy = all.find((x) => x.replaces_choice_id === c.id);
  // Outras propostas da mesma área nesta etapa: registos distintos, cada um com o seu estado.
  const others = all.filter((x) => x.id !== c.id && x.stage_path_id === c.stage_path_id && x.area_code === c.area_code);
  const filled = (t?: string | null) => !!t && !/^[\s—–-]*$/.test(t);
  const decidedLabel = c.status === 'retirada' ? 'Retirada' : c.status === 'substituida' ? 'Substituída' : c.status === 'recusada' ? 'Não aceite' : 'Confirmada';

  return (
    <>
      <PageTitle title={trail?.name ?? 'Proposta'} subtitle="Proposta de trilho para a etapa (negociação)" back="/acompanhamento/pedidos?tipo=negociacao" />
      <div className="row" style={{ marginBottom: 12 }}>
        <Badge {...st} />
        <span className="faint">Proposta {proposalRef(c)}</span>
      </div>

      <section className="card request-summary" aria-label="Resumo da proposta">
        {member && (
          <div className="row request-who">
            <Avatar name={member.profiles?.full_name ?? '?'} photoPath={member.profiles?.photo_path} />
            <div className="grow">
              <strong>{member.profiles?.full_name}</strong>
              {team && <span className="faint"> · {team}</span>}
            </div>
            <Link to={`/membros/${member.id}`} className="btn ghost">Percurso</Link>
          </div>
        )}
        <dl className="meta compact-meta">
          <dt>Identificador</dt><dd>{proposalRef(c)}</dd>
          <dt>Etapa</dt><dd>{stage}</dd>
          <dt>Área</dt><dd>{area?.name}</dd>
          <dt>Trilho</dt><dd>{trail?.name ?? c.trail_key}</dd>
          <dt>Proposta em</dt><dd>{formatDateTime(c.proposed_at)}{nameOf(c.proposed_by) ? ` · ${nameOf(c.proposed_by)}` : ''}</dd>
          {c.status !== 'proposta' && c.decided_at && (
            <><dt>{decidedLabel} em</dt><dd>{formatDateTime(c.decided_at)}{nameOf(c.decided_by) ? ` · ${nameOf(c.decided_by)}` : ''}</dd></>
          )}
          {replaces && <><dt>Substitui</dt><dd><Link to={`/acompanhamento/proposta/${replaces.id}`}>{proposalRef(replaces)}</Link> · {catalog.trailById.get(replaces.trail_id)?.name}</dd></>}
          {replacedBy && <><dt>Substituída por</dt><dd><Link to={`/acompanhamento/proposta/${replacedBy.id}`}>{proposalRef(replacedBy)}</Link> · {catalog.trailById.get(replacedBy.trail_id)?.name}</dd></>}
        </dl>
        {filled(c.planned_opportunities) && (
          <>
            <p className="label" style={{ marginTop: 14 }}>Oportunidades previstas</p>
            <div className="quote prose">{c.planned_opportunities}</div>
          </>
        )}
        {filled(c.decision_comment) && (
          <>
            <p className="label" style={{ marginTop: 14 }}>Comentário da decisão</p>
            <div className="quote prose">{c.decision_comment}</div>
          </>
        )}
      </section>

      {c.status === 'proposta' && <ChoiceDecision choice={c} stage={stage} bare />}

      {others.length > 0 && (
        <>
          <h2 className="section-title">Outras propostas desta área na etapa</h2>
          <div className="card">
            <ul className="list">
              {others.map((o) => (
                <li key={o.id}>
                  <Link to={`/acompanhamento/proposta/${o.id}`} className="list-item">
                    <span className="grow">
                      <strong>{catalog.trailById.get(o.trail_id)?.name}</strong>
                      <br />
                      <span className="faint">{proposalRef(o)} · proposta em {formatDateTime(o.proposed_at)}</span>
                    </span>
                    <Badge {...CHOICE_STATUS[o.status]} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
