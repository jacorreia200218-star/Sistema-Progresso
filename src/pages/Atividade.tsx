import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { fetchActivity } from '../lib/api';
import { Empty, ErrorBox, Loading, PageTitle } from '../components/ui';
import { Crumbs } from '../components/nav';
import { ActivityList } from './Home';

/** Atividade recente da secção (decisões e etapas), mais recente primeiro. */
export default function Atividade() {
  const { membership } = useActiveSection();
  const q = useQuery({ queryKey: ['activity', membership.section_id, 50], queryFn: () => fetchActivity(membership.section_id, 50) });
  return (
    <>
      <Crumbs items={[{ label: 'Início', to: '/' }, { label: 'Atividade' }]} />
      <PageTitle title="Atividade" />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <div className="card">{q.data?.length ? <ActivityList items={q.data} /> : <Empty title="Ainda sem atividade." />}</div>
      )}
    </>
  );
}
