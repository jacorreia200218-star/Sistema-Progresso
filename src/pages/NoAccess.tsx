import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSection } from '../lib/session';
import { call } from '../lib/api';
import { clearInviteCode, normalizeInviteCode, readInviteCode } from '../lib/invite';
import { useAction } from '../lib/useAction';
import { memberStatusLabel } from '../lib/labels';
import { ErrorBox, Field, Notice } from '../components/ui';
import PublicShell from './public/PublicShell';

/** Indicação da equipa enquanto o pedido de entrada está pendente. */
function TeamChoice({ membershipId, current, onSaved }: { membershipId: string; current: string; onSaved: () => void }) {
  const opts = useQuery({
    queryKey: ['join_team_options'],
    queryFn: () => call<{ membership_id: string; team_id: string; team_name: string }[] | null>('join_team_options').then((d) => d ?? []),
  });
  const action = useAction();
  const [team, setTeam] = useState(current);
  const teams = (opts.data ?? []).filter((o) => o.membership_id === membershipId);
  if (!teams.length) return null;
  return (
    <>
      <ErrorBox error={action.error} />
      {action.success && team === current && <Notice kind="success">{action.success}</Notice>}
      <Field label="A que equipa pertences?" htmlFor={`eq-${membershipId}`}>
        <select id={`eq-${membershipId}`} value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Ainda não sei</option>
          {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>
      </Field>
      <button type="button" className="btn secondary" disabled={action.busy || team === current}
        onClick={async () => {
          const r = await action.run(() => call('set_requested_team', { p_membership: membershipId, p_team: team || null }), 'Equipa indicada. A administração confirma ao aprovar.');
          if (r.ok) onSaved();
        }}>
        Guardar equipa
      </button>
    </>
  );
}

interface InvitePreview { ok: boolean; error?: string; section?: string; group?: string | null; team?: string | null; already?: boolean }

/** Ecrã para quem tem conta mas ainda não tem acesso ativo a uma secção. */
export default function NoAccess() {
  const s = useSection();
  const [code, setCode] = useState(readInviteCode);
  const action = useAction();
  const suspended = s.memberships.filter((m) => m.status === 'suspenso');

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // 1.º passo: mostrar o destino do convite; 2.º passo: confirmar a entrada.
  async function check(e: FormEvent) {
    e.preventDefault();
    setJoinError(null);
    setPreview(null);
    const res = await action.run(() => call<InvitePreview>('invite_preview', { p_code: normalizeInviteCode(code) }));
    if (!res.ok || !res.value) return;
    if (!res.value.ok) setJoinError(res.value.error ?? 'Código de convite inválido.');
    else if (res.value.already) setJoinError('Já tens um pedido ou acesso nesta secção.');
    else setPreview(res.value);
  }
  async function confirm() {
    setJoinError(null);
    const res = await action.run(() => call<{ ok: boolean; error?: string }>('join_section', { p_code: normalizeInviteCode(code) }));
    if (!res.ok || !res.value) return;
    if (!res.value.ok) {
      setJoinError(res.value.error ?? 'Não foi possível usar o convite.');
      setPreview(null);
      return;
    }
    clearInviteCode();
    setCode('');
    setPreview(null);
    s.refetch();
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
            <div key={m.id}>
              <p>{m.sections?.name ?? 'Secção'} — {memberStatusLabel[m.status]}.</p>
              <TeamChoice membershipId={m.id} current={m.requested_team_id ?? ''} onSaved={s.refetch} />
            </div>
          ))}
          <p className="muted">A administração da secção confirma a tua entrada, a equipa e a função (e pode corrigi-las mais tarde).</p>
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
          {joinError && <Notice kind="error"><p>{joinError}</p></Notice>}
          {!preview ? (
            <form onSubmit={check}>
              <Field label="Código do convite" htmlFor="code" hint="8 letras e números, por exemplo AB7K-9M2P. Com ou sem hífen.">
                <input id="code" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} required aria-describedby="code-hint"
                  value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <button className="btn block" disabled={action.busy || !code.trim()}>{action.busy ? 'A verificar…' : 'Continuar'}</button>
            </form>
          ) : (
            <div>
              <p className="faint" style={{ margin: 0 }}>Vais pedir entrada em</p>
              <p className="invite-dest">
                <strong>{preview.section}</strong>{preview.group ? ` · ${preview.group}` : ''}
                {preview.team && <><br />Equipa: <strong>{preview.team}</strong></>}
              </p>
              <p className="faint">A administração da secção confirma a tua entrada, a equipa e a função. O convite não dá funções de dirigente nem de administração.</p>
              <div className="btn-row">
                <button type="button" className="btn" disabled={action.busy} onClick={confirm}>{action.busy ? 'A enviar…' : 'Confirmar entrada'}</button>
                <button type="button" className="btn ghost" onClick={() => setPreview(null)}>Mudar código</button>
              </div>
            </div>
          )}
        </div>
      )}
      <button type="button" className="btn ghost" onClick={() => supabase.auth.signOut()}>
        <LogOut size={18} aria-hidden="true" /> Sair
      </button>
    </PublicShell>
  );
}
