import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveSection } from '../lib/session';
import { useProgress } from '../lib/hooks';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { activeRequest } from '../lib/progress';
import { Empty, ErrorBox, Loading, Notice, PageTitle } from '../components/ui';
import { RequestList } from '../components/RequestList';
import { TrailPicker } from '../components/TrailPicker';

export default function Historical() {
  const { membership, catalog, settings } = useActiveSection();
  const q = useProgress(membership.id);
  const action = useAction();
  const navigate = useNavigate();
  const [trail, setTrail] = useState('');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const enabled = !!settings?.historical_progress_enabled;
  const mine = q.data.requests.filter((r) => r.kind === 'historico');

  async function create() {
    const res = await action.run(() => call<string>('create_trail_request', { p_membership: membership.id, p_trail: trail, p_kind: 'historico' }));
    if (res.ok && res.value) navigate(`/meu-progresso/trilho/${catalog.trailById.get(trail)?.key}#pedido`);
  }

  return (
    <>
      <PageTitle title="Progresso anterior" subtitle="Trilhos que já concluíste antes de usar a aplicação." back="/meu-progresso?vista=pedidos" />
      {enabled ? (
        <div className="card">
          <p className="prose">
            Indica cada trilho já concluído, com uma explicação e, se quiseres, uma data aproximada e um comprovativo. Estes pedidos
            seguem diretamente para os dirigentes e <strong>só contam depois de aprovados</strong>.
          </p>
          <ErrorBox error={action.error} />
          <TrailPicker catalog={catalog} id="trail" value={trail} onChange={setTrail} available={(t) => !activeRequest(q.data!.requests, t.key)} />
          <button type="button" className="btn" disabled={!trail || action.busy} onClick={create}>
            Criar pedido
          </button>
        </div>
      ) : (
        <Notice kind="info">
          <p className="prose">O registo de progresso anterior não está disponível nesta secção. Os pedidos já enviados continuam a ser avaliados.</p>
        </Notice>
      )}
      <h2 className="section-title">Os meus pedidos de progresso anterior</h2>
      <div className="card">
        {mine.length ? <RequestList requests={mine} catalog={catalog} /> : <Empty title="Sem pedidos de progresso anterior." />}
      </div>
    </>
  );
}
