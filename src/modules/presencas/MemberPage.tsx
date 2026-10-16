// Detalhe individual: indicadores, datas de cada sessão e histórico de correções.
// Quem regista vê qualquer pioneiro/guia; os restantes só a si próprios (verificado no servidor).
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Empty, ErrorBox, Loading, PageTitle } from '../../components/ui';
import { call } from '../../lib/api';
import { formatDay, todayLisbon } from '../common';
import { KIND_LABEL, useSectionId, type MemberDetail } from './api';
import { Filters, HistoryList, periodQuery, StatsTiles, StatusMark, usePeriod } from './parts';

export function MemberPage() {
  const { id = '' } = useParams();
  return <MemberView membershipId={id} />;
}

export function MemberView({ membershipId, self }: { membershipId: string; self?: boolean }) {
  const section = useSectionId();
  const today = todayLisbon();
  const period = usePeriod(today);
  const q = useQuery({
    queryKey: ['pres-member', section, membershipId, period.from, period.to],
    queryFn: () => call<MemberDetail>('pres_member', { p_section: section, p_membership: membershipId, p_from: period.from, p_to: period.to }),
  });
  const d = q.data;
  const fn = d?.member.function;
  const counts = fn === 'pioneiro' || fn === 'guia';
  return (
    <>
      {!self && <PageTitle title={d?.member.name ?? 'Presenças'} back="/presencas" subtitle={d ? (d.member.team_name ?? 'Sem equipa') : undefined} />}
      <Filters today={today} />
      {q.isLoading && <Loading />}
      <ErrorBox error={q.error} retry={() => q.refetch()} />
      {d && (
        <>
          <section className="card">
            <h2 className="pres-h2">{self ? 'As tuas presenças' : 'Indicadores'} <span className="faint pres-small pres-normal">· {period.label}</span></h2>
            <StatsTiles stats={d.stats} label="Indicadores" />
            {d.member.entry_date && (
              <p className="faint pres-small pres-center">Conta a partir de {formatDay(d.member.entry_date)} (data de entrada na secção).</p>
            )}
            {!counts && d.entries.length === 0 && (
              <p className="faint pres-small pres-center">As presenças contam para pioneiros e guias; os dirigentes não entram nas contas.</p>
            )}
          </section>
          <section className="card">
            <h2 className="pres-h2">Datas</h2>
            {d.entries.length === 0 ? (
              <Empty title="Sem sessões neste período.">
                <p className="faint pres-small pres-center">Quando houver reuniões ou atividades em que contes, aparecem aqui.</p>
              </Empty>
            ) : (
              <ul className="list pres-entries" aria-label="Datas e estados">
                {d.entries.map((e) => (
                  <li key={e.session_id} className="pres-entry">
                    <div className="grow">
                      <div className="pres-row-title">
                        {d.can_register ? <Link to={`/presencas/sessoes/${e.session_id}${periodQuery()}`}>{e.title}</Link> : e.title}
                      </div>
                      <div className="faint pres-small">{formatDay(e.date)} · {KIND_LABEL[e.kind as 'reuniao']} · {e.team_name ?? 'Secção'}</div>
                      {e.partial && e.partial_note && <div className="pres-small">Parcial: {e.partial_note}</div>}
                      {e.justification && <div className="pres-small pres-just">Justificação: {e.justification}</div>}
                    </div>
                    <StatusMark category={e.category} partial={e.partial} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <details className="card flat pres-details">
            <summary>Histórico de correções</summary>
            <HistoryList rows={d.history} showSession />
          </details>
            </>
      )}
    </>
  );
}
