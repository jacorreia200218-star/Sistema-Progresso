import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { useMembers, useTeams } from '../lib/hooks';
import { fetchSectionRequests, fetchSectionStagePaths } from '../lib/api';
import { functionLabel } from '../lib/labels';
import { Avatar, Empty, ErrorBox, Loading, Notice, PageTitle } from '../components/ui';
import { RequestList } from '../components/RequestList';
import { stageName } from '../components/StagePanel';

/** Painel do guia: apenas a sua equipa atual (o servidor garante-o via RLS). */
export default function Team() {
  const { membership, catalog } = useActiveSection();
  const teams = useTeams(membership.section_id);
  const members = useMembers(membership.section_id);
  const teamMembers = (members.data ?? []).filter((m) => m.team_id === membership.team_id && m.status === 'ativo');
  const ids = teamMembers.map((m) => m.id);
  const reqs = useQuery({ queryKey: ['section-requests', membership.section_id, 'equipa'], queryFn: () => fetchSectionRequests(membership.section_id) });
  const paths = useQuery({ queryKey: ['paths', ids], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });

  if (members.isLoading || reqs.isLoading) return <Loading />;
  if (members.error || reqs.error) return <ErrorBox error={members.error ?? reqs.error} retry={() => { members.refetch(); reqs.refetch(); }} />;

  const team = teams.data?.find((t) => t.id === membership.team_id);
  const names = Object.fromEntries((members.data ?? []).map((m) => [m.id, m.profiles?.full_name ?? '']));
  const all = (reqs.data ?? []).filter((r) => ids.includes(r.membership_id) && r.kind === 'normal');
  const queue = all.filter((r) => (r.status === 'submetido' || r.status === 'em_revisao') && r.membership_id !== membership.id);
  const mineWaiting = all.filter((r) => (r.status === 'submetido' || r.status === 'em_revisao') && r.membership_id === membership.id);
  const recent = all.filter((r) => r.status === 'validado_equipa' || r.status === 'devolvido').slice(0, 10);

  return (
    <>
      <PageTitle title={team ? `Equipa ${team.name.replace(/^Equipa\s+/i, '')}` : 'Equipa'} subtitle="Pedidos para a reunião de Equipa e acompanhamento dos teus companheiros." />
      <h2 className="section-title">Pedidos para a reunião de Equipa</h2>
      <div className="card">
        <p className="faint prose">Na reunião, a Equipa decide em conjunto. Aqui registas a decisão tomada — o registo não substitui a reunião.</p>
        {queue.length ? <RequestList requests={queue} catalog={catalog} names={names} base="/revisoes/pedido" /> : <Empty title="Sem pedidos à espera." />}
      </div>
      {mineWaiting.length > 0 && (
        <Notice kind="info">
          <p className="prose">Tens {mineWaiting.length} pedido(s) teu(s) em análise. Não podes registar a decisão sobre os teus próprios pedidos: a Equipa de Animação regista-a em nome da reunião de Equipa.</p>
        </Notice>
      )}
      <h2 className="section-title">Comunicado ao Conselho de Guias</h2>
      <div className="card">
        {recent.length ? <RequestList requests={recent} catalog={catalog} names={names} base="/revisoes/pedido" /> : <Empty title="Ainda sem decisões registadas." />}
      </div>
      <h2 className="section-title">Membros da equipa</h2>
      <div className="card">
        <ul className="list">
          {teamMembers.map((m) => {
            const open = (paths.data ?? []).find((p) => p.membership_id === m.id && p.status === 'em_curso');
            const validated = (reqs.data ?? []).filter((r) => r.membership_id === m.id && (r.status === 'validado_equipa' || r.status === 'aprovado')).length;
            return (
              <li key={m.id}>
                <Link to={`/membros/${m.id}`} className="list-item">
                  <Avatar name={m.profiles?.full_name ?? '?'} photoPath={m.profiles?.photo_path} />
                  <span className="grow">
                    <strong>{m.profiles?.full_name}</strong>
                    <br />
                    <span className="faint">
                      {m.function ? functionLabel[m.function] : ''} · {open ? `Etapa ${stageName(catalog, open.stage_key)}` : 'Sem etapa em curso'} · {validated} trilho(s) validado(s)
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
