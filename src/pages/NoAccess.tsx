import { useState, type FormEvent } from 'react';
import { Clock, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSection } from '../lib/session';
import { call } from '../lib/api';
import { clearInviteCode, readInviteCode } from '../lib/invite';
import { useAction } from '../lib/useAction';
import { memberStatusLabel } from '../lib/labels';
import { ErrorBox, Field, Notice } from '../components/ui';
import PublicShell from './public/PublicShell';

/** Ecrã para quem tem conta mas ainda não tem acesso ativo a uma secção. */
export default function NoAccess() {
  const s = useSection();
  const [code, setCode] = useState(readInviteCode);
  const action = useAction();
  const suspended = s.memberships.filter((m) => m.status === 'suspenso');

  async function join(e: FormEvent) {
    e.preventDefault();
    const res = await action.run(() => call('redeem_invite', { p_code: code.trim() }), 'Pedido de entrada enviado.');
    if (res.ok) {
      clearInviteCode();
      setCode('');
      s.refetch();
    }
  }

  return (
    <PublicShell title="Entrada na secção">
      <h1>Olá{s.profile?.full_name ? `, ${s.profile.full_name.split(' ')[0]}` : ''}</h1>
      {s.pending.length > 0 && (
        <div className="card">
          <div className="card-title">
            <Clock aria-hidden="true" color="var(--green-ink)" />
            <h2 style={{ margin: 0 }}>Pedido de entrada enviado</h2>
          </div>
          {s.pending.map((m) => (
            <p key={m.id}>
              {m.sections?.name ?? 'Secção'} — {memberStatusLabel[m.status]}.
            </p>
          ))}
          <p className="muted">A administração da secção vai confirmar a tua entrada, a tua equipa e a tua função.</p>
          <button type="button" className="btn secondary" onClick={s.refetch}>Verificar de novo</button>
        </div>
      )}
      {suspended.length > 0 && (
        <Notice kind="warn">
          <p>O teu acesso a {suspended.map((m) => m.sections?.name).join(', ')} está suspenso. Fala com a administração da secção.</p>
        </Notice>
      )}
      {s.pending.length === 0 && (
        <div className="card">
          <h2>Tenho um convite</h2>
          <p className="muted">Cola o código do convite que recebeste da tua secção (ou abre o link do convite).</p>
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          <form onSubmit={join}>
            <Field label="Código do convite" htmlFor="code">
              <input id="code" type="text" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <button className="btn block" disabled={action.busy || !code.trim()}>
              {action.busy ? 'A enviar…' : 'Pedir entrada'}
            </button>
          </form>
        </div>
      )}
      <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>
        <LogOut size={18} aria-hidden="true" /> Sair
      </button>
    </PublicShell>
  );
}
