import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { useMembers, useTeams } from '../lib/hooks';
import { call, fetchInvites, fetchMembershipHistory, fetchSettingsHistory, type MemberRow } from '../lib/api';
import { useAction } from '../lib/useAction';
import { formatDate, formatDateTime, functionLabel, memberStatusLabel } from '../lib/labels';
import type { MemberFunction, Team } from '../lib/types';
import { Avatar, Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../components/ui';
import { InviteShare } from '../components/InviteShare';

const TABS = [
  ['membros', 'Membros'],
  ['equipas', 'Equipas'],
  ['convites', 'Convites'],
  ['configuracoes', 'Configurações'],
  ['registo', 'Histórico'],
] as const;

export default function Admin() {
  const tab = useParams().tab ?? 'membros';
  return (
    <>
      <PageTitle title="Gestão" subtitle="Administração técnica: membros, equipas, convites e configurações." />
      <nav className="tabs" aria-label="Secções da gestão">
        {TABS.map(([k, l]) => (
          <Link key={k} to={`/gestao/${k}`} className="tab" aria-current={tab === k ? 'page' : undefined}>{l}</Link>
        ))}
      </nav>
      {tab === 'membros' && <Members />}
      {tab === 'equipas' && <Teams />}
      {tab === 'convites' && <Invites />}
      {tab === 'configuracoes' && <Settings />}
      {tab === 'registo' && <Log />}
    </>
  );
}

function RoleFields({ fn, setFn, team, setTeam, teams, idp, allowNone }: {
  fn: MemberFunction | ''; setFn: (v: MemberFunction | '') => void; team: string; setTeam: (v: string) => void; teams: Team[]; idp: string; allowNone?: boolean;
}) {
  return (
    <div className="grid-2">
      <Field label="Função" htmlFor={`${idp}-fn`}>
        <select id={`${idp}-fn`} value={fn} onChange={(e) => setFn(e.target.value as MemberFunction | '')}>
          {allowNone && <option value="">Sem função pedagógica (só administração)</option>}
          {!allowNone && <option value="">Escolhe…</option>}
          <option value="pioneiro">Pioneiro</option>
          <option value="guia">Guia</option>
          <option value="dirigente">Dirigente (Equipa de Animação)</option>
        </select>
      </Field>
      {(fn === 'pioneiro' || fn === 'guia') && (
        <Field label="Equipa" htmlFor={`${idp}-team`}>
          <select id={`${idp}-team`} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Escolhe…</option>
            {teams.filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

/** Nome e totem do membro, editáveis pela administração (fica no registo). */
function NameFields({ m }: { m: MemberRow }) {
  const action = useAction();
  const [name, setName] = useState(m.profiles?.full_name ?? '');
  const [totem, setTotem] = useState(m.profiles?.totem ?? '');
  const dirty = name.trim() !== (m.profiles?.full_name ?? '') || totem.trim() !== (m.profiles?.totem ?? '');
  return (
    <div className="name-fields">
      <div className="grid-2">
        <Field label="Nome" htmlFor={`nm-${m.id}`}>
          <input id={`nm-${m.id}`} type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Totem (opcional)" htmlFor={`tt-${m.id}`}>
          <input id={`tt-${m.id}`} type="text" value={totem} maxLength={120} onChange={(e) => setTotem(e.target.value)} />
        </Field>
      </div>
      <ErrorBox error={action.error} />
      {action.success && !dirty && <Notice kind="success">{action.success}</Notice>}
      {dirty && (
        <button type="button" className="btn secondary" disabled={action.busy || !name.trim()}
          onClick={() => action.run(() => call('admin_update_profile', { p_membership: m.id, p_full_name: name, p_totem: totem }), 'Nome guardado.')}>
          Guardar nome
        </button>
      )}
    </div>
  );
}

function PendingRow({ m, teams }: { m: MemberRow; teams: Team[] }) {
  const action = useAction();
  const [fn, setFn] = useState<MemberFunction | ''>('pioneiro');
  const [team, setTeam] = useState(m.requested_team_id ?? '');
  const [reason, setReason] = useState('');
  const requested = teams.find((t) => t.id === m.requested_team_id);
  return (
    <div className="card flat">
      <div className="row">
        <Avatar name={m.profiles?.full_name ?? '?'} />
        <div className="grow">
          <strong>{m.profiles?.full_name || 'Sem nome'}</strong>
          <br />
          <span className="faint">Pedido em {formatDateTime(m.requested_at)}{requested ? ` · indicou a equipa ${requested.name}` : ' · não indicou equipa'}</span>
        </div>
      </div>
      <ErrorBox error={action.error} />
      {action.success ? <Notice kind="success">{action.success}</Notice> : (
        <>
          <p className="faint prose" style={{ marginTop: 10 }}>Confirma que conheces esta pessoa antes de aprovar. A equipa indicada vem pré-preenchida e podes corrigi-la; a função é atribuída por ti.</p>
          <NameFields m={m} />
          <RoleFields fn={fn} setFn={setFn} team={team} setTeam={setTeam} teams={teams} idp={m.id} />
          <div className="btn-row" style={{ marginTop: 0 }}>
            <button type="button" className="btn" disabled={action.busy || !fn || ((fn === 'pioneiro' || fn === 'guia') && !team)}
              onClick={() => action.run(() => call('approve_membership', { p_membership: m.id, p_function: fn, p_team: team || null }), 'Entrada confirmada.')}>
              Aprovar entrada
            </button>
          </div>
          <Field label="Motivo para recusar" htmlFor={`rj-${m.id}`}>
            <input id={`rj-${m.id}`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ConfirmButton className="btn ghost" confirmLabel="Recusar pedido" disabled={action.busy || !reason.trim()}
            onConfirm={() => action.run(() => call('set_membership_status', { p_membership: m.id, p_status: 'saiu', p_reason: reason }), 'Pedido recusado.')}>
            Recusar
          </ConfirmButton>
        </>
      )}
    </div>
  );
}

function MemberEditor({ m, teams }: { m: MemberRow; teams: Team[] }) {
  const action = useAction();
  const [fn, setFn] = useState<MemberFunction | ''>(m.function ?? '');
  const [team, setTeam] = useState(m.team_id ?? '');
  const [isAdmin, setIsAdmin] = useState(m.is_admin);
  const [reason, setReason] = useState('');
  return (
    <details className="card flat">
      <summary className="row" style={{ cursor: 'pointer' }}>
        <Avatar name={m.profiles?.full_name ?? '?'} photoPath={m.profiles?.photo_path} />
        <span className="grow">
          <strong>{m.profiles?.full_name}</strong>
          <br />
          <span className="faint">
            {m.function ? functionLabel[m.function] : 'Sem função pedagógica'}
            {m.team_id ? ` · ${teams.find((t) => t.id === m.team_id)?.name ?? ''}` : ''}
            {m.is_admin ? ' · Administração' : ''}
          </span>
        </span>
        {m.status !== 'ativo' && <Badge label={memberStatusLabel[m.status]} tone="attention" icon="x" />}
      </summary>
      <div style={{ marginTop: 12 }}>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <NameFields m={m} />
        <RoleFields fn={fn} setFn={setFn} team={team} setTeam={setTeam} teams={teams} idp={m.id} allowNone />
        <label className="checkbox"><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Administração técnica (gere membros, equipas, convites e configurações)</label>
        <Field label="Motivo da alteração (fica no histórico)" htmlFor={`r-${m.id}`}>
          <input id={`r-${m.id}`} type="text" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="btn-row" style={{ marginTop: 0 }}>
          <button type="button" className="btn" disabled={action.busy}
            onClick={() => action.run(() => call('update_membership', { p_membership: m.id, p_function: fn || null, p_team: team || null, p_is_admin: isAdmin, p_reason: reason }), 'Alterações guardadas.')}>
            Guardar
          </button>
          {m.status === 'ativo' ? (
            <ConfirmButton className="btn secondary" confirmLabel="Suspender acesso" disabled={action.busy || !reason.trim()} description="Indica o motivo acima. A pessoa deixa de aceder aos dados até ser reativada."
              onConfirm={() => action.run(() => call('set_membership_status', { p_membership: m.id, p_status: 'suspenso', p_reason: reason }), 'Acesso suspenso.')}>
              Suspender
            </ConfirmButton>
          ) : m.status === 'suspenso' ? (
            <button type="button" className="btn secondary" disabled={action.busy}
              onClick={() => action.run(() => call('set_membership_status', { p_membership: m.id, p_status: 'ativo', p_reason: reason || 'Reativação' }), 'Acesso reativado.')}>
              Reativar
            </button>
          ) : null}
          {m.status !== 'saiu' && (
            <ConfirmButton className="btn ghost" confirmLabel="Registar saída" disabled={action.busy || !reason.trim()} description="O histórico pedagógico mantém-se. Indica o motivo acima."
              onConfirm={() => action.run(() => call('set_membership_status', { p_membership: m.id, p_status: 'saiu', p_reason: reason }), 'Saída registada.')}>
              Saiu da secção
            </ConfirmButton>
          )}
        </div>
      </div>
    </details>
  );
}

function Members() {
  const { membership } = useActiveSection();
  const members = useMembers(membership.section_id);
  const teams = useTeams(membership.section_id);
  if (members.isLoading || teams.isLoading) return <Loading />;
  if (members.error) return <ErrorBox error={members.error} retry={members.refetch} />;
  const all = members.data ?? [];
  const pending = all.filter((m) => m.status === 'pendente');
  const current = all.filter((m) => m.status === 'ativo' || m.status === 'suspenso');
  const left = all.filter((m) => m.status === 'saiu');
  return (
    <>
      <h2 className="section-title">Pedidos de entrada ({pending.length})</h2>
      {pending.length ? pending.map((m) => <PendingRow key={m.id} m={m} teams={teams.data ?? []} />) : <div className="card"><Empty title="Sem pedidos de entrada." /></div>}
      <h2 className="section-title">Membros ({current.length})</h2>
      {current.map((m) => <MemberEditor key={m.id} m={m} teams={teams.data ?? []} />)}
      {left.length > 0 && (
        <details className="card flat">
          <summary>Saíram ou foram recusados ({left.length})</summary>
          <ul className="list">{left.map((m) => <li key={m.id} className="list-item">{m.profiles?.full_name}</li>)}</ul>
        </details>
      )}
    </>
  );
}

function Teams() {
  const { membership } = useActiveSection();
  const teams = useTeams(membership.section_id);
  const members = useMembers(membership.section_id);
  const action = useAction();
  const [name, setName] = useState('');
  const [renames, setRenames] = useState<Record<string, string>>({});
  if (teams.isLoading) return <Loading />;
  return (
    <>
      <div className="card">
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <Field label="Nova equipa" htmlFor="tn"><input id="tn" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
        <button type="button" className="btn" disabled={action.busy || !name.trim()}
          onClick={async () => { const r = await action.run(() => call('create_team', { p_section: membership.section_id, p_name: name }), 'Equipa criada.'); if (r.ok) setName(''); }}>
          Criar equipa
        </button>
      </div>
      {(teams.data ?? []).filter((t) => !t.archived_at).map((t) => {
        const count = (members.data ?? []).filter((m) => m.team_id === t.id && m.status === 'ativo').length;
        return (
          <div key={t.id} className="card flat">
            <div className="row between"><strong>{t.name}</strong><span className="faint">{count} membro(s)</span></div>
            <div className="row" style={{ marginTop: 8 }}>
              <input type="text" aria-label={`Novo nome para ${t.name}`} value={renames[t.id] ?? t.name} onChange={(e) => setRenames({ ...renames, [t.id]: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
              <button type="button" className="btn secondary" disabled={action.busy || !(renames[t.id] ?? '').trim() || renames[t.id] === t.name}
                onClick={() => action.run(() => call('rename_team', { p_team: t.id, p_name: renames[t.id] }), 'Equipa renomeada.')}>
                Renomear
              </button>
              <ConfirmButton className="btn ghost" confirmLabel="Arquivar" disabled={action.busy} description="Só é possível sem membros ativos na equipa."
                onConfirm={() => action.run(() => call('archive_team', { p_team: t.id }), 'Equipa arquivada.')}>
                Arquivar
              </ConfirmButton>
            </div>
          </div>
        );
      })}
    </>
  );
}

function Invites() {
  const { membership } = useActiveSection();
  const q = useQuery({ queryKey: ['invites', membership.section_id], queryFn: () => fetchInvites(membership.section_id) });
  const teams = useTeams(membership.section_id);
  const action = useAction();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(14);
  const [uses, setUses] = useState(10);
  const [team, setTeam] = useState('');
  const teamName = (id: string | null) => (id ? teams.data?.find((t) => t.id === id)?.name ?? 'Equipa' : null);

  async function create() {
    const expires = new Date(Date.now() + days * 86400_000).toISOString();
    await action.run(() => call<string>('create_invite', { p_section: membership.section_id, p_label: label, p_expires_at: expires, p_max_uses: uses, p_team: team || null }), 'Convite criado.');
  }

  return (
    <>
      <details className="card">
        <summary className="row" style={{ cursor: 'pointer' }}><strong>Novo convite</strong></summary>
        <p className="faint prose" style={{ marginTop: 8 }}>O convite permite pedir entrada; cada pessoa usa a sua conta e o pedido continua a precisar da tua confirmação. Nunca dá funções de dirigente nem de administração.</p>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <Field label="Descrição (para ti)" htmlFor="il"><input id="il" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Pioneiros 2026/27" /></Field>
        <Field label="Destino" htmlFor="it">
          <select id="it" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Secção (a pessoa indica a equipa)</option>
            {(teams.data ?? []).filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Validade (dias)" htmlFor="id"><input id="id" type="number" min={1} max={180} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
          <Field label="Limite de utilizações" htmlFor="iu"><input id="iu" type="number" min={1} max={500} value={uses} onChange={(e) => setUses(Number(e.target.value))} /></Field>
        </div>
        <button type="button" className="btn" disabled={action.busy || days < 1 || uses < 1} onClick={create}>Criar convite</button>
      </details>
      <h2 className="section-title">Convites</h2>
      <div className="card">
        {q.isLoading ? <Loading /> : !(q.data ?? []).length ? <Empty title="Ainda não criaste convites." /> : (
          <ul className="list">
            {(q.data ?? []).map((i) => {
              const expired = new Date(i.expires_at) <= new Date();
              const state = i.revoked_at ? (i.replaced_by ? 'Substituído' : 'Revogado') : expired ? 'Expirado' : i.use_count >= i.max_uses ? 'Esgotado' : 'Ativo';
              const active = state === 'Ativo';
              return (
                <li key={i.id} className="invite-item">
                  <div className="row between">
                    <span className="grow">
                      <strong>{i.label || 'Convite'}</strong>
                      <br />
                      <span className="faint">{teamName(i.team_id) ?? 'Secção'} · {i.use_count}/{i.max_uses} utilizações · válido até {formatDate(i.expires_at)}</span>
                    </span>
                    <Badge label={state} tone={active ? 'ok' : 'muted'} icon={active ? 'check' : 'x'} />
                  </div>
                  {active && (i.code ? <InviteShare code={i.code} /> : <p className="faint prose">Convite antigo (código longo, mostrado só na criação). Gera um novo para teres um código curto.</p>)}
                  <div className="btn-row">
                    {(active || state === 'Esgotado' || state === 'Expirado') && (
                      <ConfirmButton className="btn ghost" confirmLabel="Gerar novo" description="Cria um código novo com as mesmas condições e revoga este."
                        onConfirm={() => action.run(() => call('regenerate_invite', { p_invite: i.id }), 'Novo convite gerado; o anterior foi revogado.')}>
                        Gerar novo
                      </ConfirmButton>
                    )}
                    {active && (
                      <ConfirmButton className="btn ghost" confirmLabel="Revogar" onConfirm={() => action.run(() => call('revoke_invite', { p_invite: i.id }), 'Convite revogado.')}>
                        Revogar
                      </ConfirmButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

function Settings() {
  const { membership, settings } = useActiveSection();
  const history = useQuery({ queryKey: ['settings-history', membership.section_id], queryFn: () => fetchSettingsHistory(membership.section_id) });
  const members = useMembers(membership.section_id);
  const action = useAction();
  const enabled = !!settings?.historical_progress_enabled;
  const names = Object.fromEntries((members.data ?? []).map((m) => [m.profile_id, m.profiles?.full_name ?? '']));
  return (
    <>
      <div className="card">
        <h2>Progresso anterior</h2>
        <p className="prose">
          Permite que pioneiros registem trilhos concluídos antes de usarem a aplicação. Estes pedidos seguem diretamente para os dirigentes.
        </p>
        <p>Estado atual: <Badge label={enabled ? 'Ativo' : 'Desativado'} tone={enabled ? 'ok' : 'muted'} icon={enabled ? 'check' : 'x'} /></p>
        <p className="faint prose">
          Ao desativar: o servidor bloqueia novas submissões (mesmo com formulários abertos); pedidos já submetidos continuam avaliáveis,
          aprovações mantêm-se e o progresso normal continua disponível. Podes reativar a qualquer momento.
        </p>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <ConfirmButton className={enabled ? 'btn secondary' : 'btn'} confirmLabel={enabled ? 'Desativar' : 'Ativar'} disabled={action.busy}
          onConfirm={() => action.run(() => call('set_historical_progress', { p_section: membership.section_id, p_enabled: !enabled }), enabled ? 'Progresso anterior desativado.' : 'Progresso anterior ativado.')}>
          {enabled ? 'Desativar progresso anterior' : 'Ativar progresso anterior'}
        </ConfirmButton>
      </div>
      <h2 className="section-title">Alterações</h2>
      <div className="card">
        {!(history.data ?? []).length ? <Empty title="Sem alterações registadas." /> : (
          <ul className="list">
            {(history.data ?? []).map((h) => (
              <li key={h.id} className="list-item">
                <span className="grow">
                  {h.new_value ? 'Ativado' : 'Desativado'} por {names[h.changed_by] || 'administrador'}
                  <br />
                  <span className="faint">{formatDateTime(h.changed_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function Log() {
  const { membership } = useActiveSection();
  const q = useQuery({ queryKey: ['membership-history', membership.section_id], queryFn: () => fetchMembershipHistory(membership.section_id) });
  const members = useMembers(membership.section_id);
  const teams = useTeams(membership.section_id);
  if (q.isLoading) return <Loading />;
  const byMembership = Object.fromEntries((members.data ?? []).map((m) => [m.id, m.profiles?.full_name ?? '']));
  const byProfile = Object.fromEntries((members.data ?? []).map((m) => [m.profile_id, m.profiles?.full_name ?? '']));
  const team = (id: string | null) => (id ? teams.data?.find((t) => t.id === id)?.name ?? '—' : '—');
  const fn = (f: string | null) => (f ? functionLabel[f as MemberFunction] : '—');
  return (
    <div className="card">
      <p className="faint prose">Histórico de mudanças de estado, função, equipa e administração. Criado automaticamente pelo servidor; não é editável.</p>
      {!(q.data ?? []).length ? <Empty title="Sem registos." /> : (
        <ul className="list">
          {(q.data ?? []).map((h) => (
            <li key={h.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className="grow">
                <strong>{byMembership[h.membership_id] || 'Membro'}</strong>
                <br />
                <span className="faint">
                  {h.old_status !== h.new_status && `Estado: ${h.old_status ?? '—'} → ${h.new_status}. `}
                  {h.old_function !== h.new_function && `Função: ${fn(h.old_function)} → ${fn(h.new_function)}. `}
                  {h.old_team_id !== h.new_team_id && `Equipa: ${team(h.old_team_id)} → ${team(h.new_team_id)}. `}
                  {h.old_is_admin !== h.new_is_admin && h.old_is_admin !== null && `Administração: ${h.new_is_admin ? 'sim' : 'não'}. `}
                  {h.reason && `Motivo: ${h.reason}. `}
                </span>
                <br />
                <span className="faint">{formatDate(h.changed_at)} · por {h.changed_by ? byProfile[h.changed_by] || 'administrador' : 'sistema'}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
