// Notificações do utilizador autenticado: abrir, marcar como lidas e eliminar
// (uma, várias, as lidas ou todas). A remoção é recuperável («Desfazer») e só
// afeta as notificações deste utilizador: pedidos, decisões, justificações e
// histórico pedagógico ficam intactos.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Trash2 } from 'lucide-react';
import { call, fetchNotificationCount, fetchNotifications } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/labels';
import type { NotificationRow } from '../lib/types';
import { ConfirmButton, ErrorBox, Loading, PageTitle } from '../components/ui';

type Scope = 'ids' | 'lidas' | 'todas';

export default function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications });
  const total = useQuery({ queryKey: ['notifications', 'total'], queryFn: fetchNotificationCount });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ ids: string[]; message: string } | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read_at);
  const read = items.filter((n) => n.read_at);
  const count = Math.max(total.data ?? 0, items.length);
  const plural = (n: number) => (n === 1 ? '1 notificação' : `${n} notificações`);

  /** Remove já da lista (e do contador de não lidas); repõe se o servidor recusar. */
  async function remove(scope: Scope, ids: string[], label: (n: number) => string) {
    const before = qc.getQueryData<NotificationRow[]>(['notifications']);
    const gone = new Set(scope === 'todas' ? items.map((n) => n.id) : scope === 'lidas' ? read.map((n) => n.id) : ids);
    setBusy(true);
    setError(null);
    setUndo(null);
    qc.setQueryData<NotificationRow[]>(['notifications'], (old) => (old ?? []).filter((n) => !gone.has(n.id)));
    try {
      const removed = await call<string[]>('remove_notifications', { p_scope: scope, p_ids: scope === 'ids' ? ids : null });
      setSelected((s) => s.filter((id) => !gone.has(id)));
      setUndo({ ids: removed ?? [], message: label((removed ?? []).length) });
    } catch (e) {
      qc.setQueryData(['notifications'], before);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  }

  async function restore() {
    if (!undo) return;
    setBusy(true);
    setError(null);
    try {
      await call('restore_notifications', { p_ids: undo.ids });
      setUndo(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  }

  async function markAllRead() {
    setBusy(true);
    setError(null);
    try {
      await call('mark_notifications_read', { p_ids: null });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  }

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allSelected = items.length > 0 && selected.length === items.length;

  return (
    <>
      <PageTitle title="Notificações" back={true} />
      <ErrorBox error={error} />
      {undo && (
        <div className="undo-bar" role="status">
          <span className="grow">{undo.message}</span>
          {undo.ids.length > 0 && <button type="button" className="btn secondary" disabled={busy} onClick={restore}>Desfazer</button>}
        </div>
      )}
      {items.length > 0 && (
        <div className="notif-tools">
          <label className="check-row">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : items.map((n) => n.id))} />
            <span>Selecionar todas</span>
          </label>
          {selected.length > 0 && (
            <button type="button" className="btn secondary" disabled={busy}
              onClick={() => remove('ids', selected, (n) => `${plural(n)} ${n === 1 ? 'eliminada' : 'eliminadas'}.`)}>
              <Trash2 size={16} aria-hidden="true" /> Eliminar selecionadas ({selected.length})
            </button>
          )}
          {unread.length > 0 && (
            <button type="button" className="btn ghost" disabled={busy} onClick={markAllRead}>Marcar todas como lidas</button>
          )}
          {read.length > 0 && (
            <button type="button" className="btn ghost" disabled={busy}
              onClick={() => remove('lidas', [], (n) => `${plural(n)} ${n === 1 ? 'lida eliminada' : 'lidas eliminadas'}.`)}>
              Eliminar lidas ({read.length})
            </button>
          )}
          <ConfirmButton className="btn ghost danger" confirmLabel={`Eliminar ${plural(count)}`} disabled={busy}
            description={`Vais eliminar ${plural(count)}, lidas e por ler. Podes desfazer logo a seguir. Os pedidos, decisões e o histórico não são afetados.`}
            onConfirm={() => remove('todas', [], (n) => `${plural(n)} ${n === 1 ? 'eliminada' : 'eliminadas'}.`)}>
            Limpar todas
          </ConfirmButton>
        </div>
      )}
      {/* Lista vazia: só uma mensagem curta. */}
      {items.length === 0 ? <p className="empty-short">Sem notificações.</p> : <div className="card">{(
          <ul className="list notif-list">
            {items.map((n) => {
              const body = (
                <>
                  <Bell size={18} aria-hidden="true" color={n.read_at ? 'var(--ink-faint)' : 'var(--accent-ink)'} />
                  <span className="grow">
                    <strong style={{ fontWeight: n.read_at ? 500 : 700 }}>{n.title}</strong>
                    {!n.read_at && <span className="sr-only"> (por ler)</span>}
                    {n.body && <><br /><span className="muted">{n.body}</span></>}
                    <br />
                    <span className="faint">{formatDateTime(n.created_at)}</span>
                  </span>
                </>
              );
              const markRead = () => {
                if (!n.read_at) call('mark_notifications_read', { p_ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })).catch(() => undefined);
              };
              return (
                <li key={n.id} className={`notif ${n.read_at ? '' : 'is-unread'}`}>
                  <input type="checkbox" className="notif-check" checked={selected.includes(n.id)} onChange={() => toggle(n.id)} aria-label={`Selecionar «${n.title}»`} />
                  {n.link ? <Link to={n.link} className="list-item grow" onClick={markRead}>{body}</Link> : <div className="list-item grow">{body}</div>}
                  <button type="button" className="btn ghost icon-btn" disabled={busy} aria-label={`Eliminar «${n.title}»`}
                    onClick={() => remove('ids', [n.id], () => 'Notificação eliminada.')}>
                    <Trash2 size={18} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}</div>}
    </>
  );
}
