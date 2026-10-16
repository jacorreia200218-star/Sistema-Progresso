// A minha situação: quotas devidas, pagas e pendentes e os meus pagamentos (com comprovativos).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, FileText, Receipt, Wallet } from 'lucide-react';
import { Badge, Empty, ErrorBox, Loading } from '../../components/ui';
import { useAction } from '../../lib/useAction';
import { formatDay, formatEuros } from '../common';
import { listModuleFiles, openModuleFile } from '../files';
import { STATE_LABEL, STATE_TONE, useMySituation, useSectionId } from './api';

export function MinePage() {
  const q = useMySituation();
  if (q.isLoading) return <Loading rows={2} />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  const s = q.data!;
  return (
    <div className="stack">
      <ul className="stats fin-stats fin-kpis" aria-label="A minha situação">
        <li><div className="stat stat-azul"><span className="stat-icon"><Receipt size={18} aria-hidden="true" /></span>
          <span className="stat-value">{formatEuros(s.totals.devido)}</span><span className="stat-label">Devido</span></div></li>
        <li><div className="stat stat-verde"><span className="stat-icon"><CheckCircle2 size={18} aria-hidden="true" /></span>
          <span className="stat-value">{formatEuros(s.totals.pago)}</span><span className="stat-label">Pago</span>
          {s.totals.pendente > 0 && <span className="stat-hint">+ {formatEuros(s.totals.pendente)} pendente</span>}</div></li>
        <li><div className="stat stat-ambar"><span className="stat-icon"><Wallet size={18} aria-hidden="true" /></span>
          <span className="stat-value" data-testid="em-falta">{formatEuros(s.totals.em_falta)}</span><span className="stat-label">Em falta</span></div></li>
      </ul>

      <section className="card" aria-labelledby="mine-quotas">
        <h2 id="mine-quotas" className="card-title">As minhas quotas</h2>
        {!s.charges.length ? <Empty title="Não tens quotas atribuídas" /> : (
          <ul className="list">
            {s.charges.map((c) => {
              const voided = c.quota_status !== 'ativa';
              const label = voided ? 'Anulada' : c.status === 'isenta' ? 'Isento' : c.em_falta === 0 ? 'Paga' : c.pendente > 0 ? 'Pagamento pendente' : 'Por pagar';
              const tone = voided || c.status === 'isenta' ? 'muted' : c.em_falta === 0 ? 'ok' : c.pendente > 0 ? 'attention' : 'progress';
              return (
                <li key={c.id} className="list-item">
                  <span className="grow">
                    <strong>{c.quota_name}</strong>
                    <span className="faint fin-sub">
                      {formatDay(c.period_start)} a {formatDay(c.period_end)} · limite {formatDay(c.due_date)} · devido {formatEuros(c.amount_cents)} · pago {formatEuros(c.pago)}
                      {c.em_falta > 0 && !voided ? ` · em falta ${formatEuros(c.em_falta)}` : ''}
                    </span>
                  </span>
                  <Badge label={label} tone={tone} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="mine-pay">
        <h2 id="mine-pay" className="card-title">Os meus pagamentos</h2>
        {!s.payments.length ? <p className="faint">Ainda não há pagamentos teus registados.</p> : (
          <ul className="list fin-movs">
            {s.payments.map((p) => (
              <li key={p.id}>
                <div className="fin-row">
                  <span className="fin-row-date">{formatDay(p.occurred_on)}</span>
                  <span className="fin-row-main">
                    <span className="fin-desc">{p.description}</span>
                    <span className="faint fin-sub">{p.quota_name && !p.description.includes(p.quota_name) ? `Quota: ${p.quota_name}` : p.category}</span>
                  </span>
                  <span className="fin-row-end">
                    <span className="fin-amount">{formatEuros(p.amount_cents)}</span>
                    {p.state !== 'efetivo' && <Badge label={STATE_LABEL[p.state]} tone={STATE_TONE[p.state]} />}
                  </span>
                </div>
                {p.files > 0 && <MyProofs id={p.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MyProofs({ id }: { id: string }) {
  const section = useSectionId();
  const [show, setShow] = useState(false);
  const act = useAction();
  const files = useQuery({ queryKey: ['fin', 'files', section, id], queryFn: () => listModuleFiles(section, 'tesouraria', 'movimento', id), enabled: show });
  return (
    <div className="fin-proofs">
      <button type="button" className="btn ghost" aria-expanded={show} onClick={() => setShow((x) => !x)}>
        <FileText size={16} aria-hidden="true" /> Comprovativo
      </button>
      <ErrorBox error={act.error} />
      {show && (files.isLoading ? <Loading compact /> : (files.data ?? []).map((f) => (
        <button key={f.path} type="button" className="btn ghost" onClick={() => act.run(() => openModuleFile(f.path))}>{f.file_name}</button>
      )))}
    </div>
  );
}
