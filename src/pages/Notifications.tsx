import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { call, fetchNotifications } from '../lib/api';
import { useAction } from '../lib/useAction';
import { formatDateTime } from '../lib/labels';
import { Empty, ErrorBox, Loading, PageTitle } from '../components/ui';

export default function Notifications() {
  const q = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications });
  const action = useAction();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read_at);
  return (
    <>
      <PageTitle title="Notificações" back={true} />
      <ErrorBox error={action.error} />
      {unread.length > 0 && (
        <button type="button" className="btn secondary" style={{ marginBottom: 12 }} disabled={action.busy}
          onClick={() => action.run(() => call('mark_notifications_read', { p_ids: null }))}>
          Marcar todas como lidas
        </button>
      )}
      <div className="card">
        {items.length === 0 ? <Empty title="Sem notificações." /> : (
          <ul className="list">
            {items.map((n) => {
              const body = (
                <>
                  <Bell size={18} aria-hidden="true" color={n.read_at ? 'var(--ink-faint)' : 'var(--red-ink)'} />
                  <span className="grow">
                    <strong style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</strong>
                    {!n.read_at && <span className="sr-only"> (por ler)</span>}
                    {n.body && <><br /><span className="muted">{n.body}</span></>}
                    <br />
                    <span className="faint">{formatDateTime(n.created_at)}</span>
                  </span>
                </>
              );
              const markRead = () => { if (!n.read_at) call('mark_notifications_read', { p_ids: [n.id] }).then(() => q.refetch()).catch(() => undefined); };
              return (
                <li key={n.id}>
                  {n.link ? <Link to={n.link} className="list-item" onClick={markRead}>{body}</Link> : <div className="list-item">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
