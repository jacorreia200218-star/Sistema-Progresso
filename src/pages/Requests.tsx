import { Link } from 'react-router-dom';
import { useActiveSection } from '../lib/session';
import { useProgress } from '../lib/hooks';
import { Empty, ErrorBox, Loading, PageTitle } from '../components/ui';
import { RequestList } from '../components/RequestList';

export default function Requests() {
  const { membership, catalog } = useActiveSection();
  const q = useProgress(membership.id);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const r = q.data.requests;
  const groups = [
    { title: 'A precisar de ti', items: r.filter((x) => x.status === 'rascunho' || x.status === 'devolvido') },
    { title: 'Em análise', items: r.filter((x) => x.status === 'submetido' || x.status === 'em_revisao') },
    { title: 'Validados', items: r.filter((x) => x.status === 'validado_equipa' || x.status === 'aprovado') },
    { title: 'Encerrados', items: r.filter((x) => x.status === 'recusado' || x.status === 'cancelado') },
  ];
  return (
    <>
      <PageTitle title="Pedidos" subtitle="Os teus pedidos de validação, com o histórico e os comentários." />
      {r.length === 0 ? (
        <div className="card">
          <Empty title="Ainda não tens pedidos.">
            <p>Quando sentires que alcançaste um trilho, abre-o em Progresso e pede a validação.</p>
            <Link to="/progresso" className="btn secondary">Ir para Progresso</Link>
          </Empty>
        </div>
      ) : (
        groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section key={g.title}>
              <h2 className="section-title">{g.title}</h2>
              <div className="card">
                <RequestList requests={g.items} catalog={catalog} />
              </div>
            </section>
          ))
      )}
    </>
  );
}
