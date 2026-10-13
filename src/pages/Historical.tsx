import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveSection } from '../lib/session';
import { useProgress } from '../lib/hooks';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { activeRequest } from '../lib/progress';
import { Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import { RequestList } from '../components/RequestList';

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
  const available = catalog.areas.flatMap((a) =>
    a.catalog_trails.filter((t) => !activeRequest(q.data!.requests, t.key)).map((t) => ({ t, a })),
  );

  async function create() {
    const res = await action.run(() => call<string>('create_trail_request', { p_membership: membership.id, p_trail: trail, p_kind: 'historico' }));
    if (res.ok && res.value) navigate(`/pedidos/${res.value}`);
  }

  return (
    <>
      <PageTitle title="Progresso anterior" subtitle="Trilhos que já concluíste antes de usar a aplicação." back="/progresso" />
      {enabled ? (
        <div className="card">
          <p>
            Indica cada trilho já concluído, com uma explicação e, se quiseres, uma data aproximada e um comprovativo. Estes pedidos
            seguem diretamente para os dirigentes e <strong>só contam depois de aprovados</strong>.
          </p>
          <ErrorBox error={action.error} />
          <Field label="Trilho" htmlFor="trail">
            <select id="trail" value={trail} onChange={(e) => setTrail(e.target.value)}>
              <option value="">Escolhe um trilho…</option>
              {catalog.areas.map((a) => (
                <optgroup key={a.id} label={a.name}>
                  {available.filter((x) => x.a.id === a.id).map(({ t }) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <button type="button" className="btn" disabled={!trail || action.busy} onClick={create}>
            Criar pedido
          </button>
        </div>
      ) : (
        <Notice kind="info">
          <p>O registo de progresso anterior não está disponível nesta secção. Os pedidos já enviados continuam a ser avaliados.</p>
        </Notice>
      )}
      <h2 className="section-title">Os meus pedidos de progresso anterior</h2>
      <div className="card">
        {mine.length ? <RequestList requests={mine} catalog={catalog} /> : <Empty title="Sem pedidos de progresso anterior." />}
      </div>
    </>
  );
}
