// Página inicial do módulo: equipas (por ano escutista), pessoas e cargos.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Filters, Loading, Notice, PageTitle } from '../../components/ui';
import {
  appointmentState, inYear, membersInYear, ROLE_KIND_LABEL, useEquipas, useSectionId, yearOptions,
  type EqMember, type EqOverview, type EqRole, type RoleKind,
} from './data';
import { BASE, Emblem, Result, teamLabel, useParam, YearSelect } from './parts';

const VIEWS = [['equipas', 'Equipas'], ['pessoas', 'Pessoas'], ['cargos', 'Cargos']] as const;

export default function Home() {
  const q = useEquipas();
  const [view, setView] = useParam('vista', 'equipas');
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const o = q.data;
  const newRole = view === 'cargos' && o.can_manage && o.roles.length > 0 && !creating
    ? <button type="button" className="btn" onClick={() => setCreating(true)}><Plus size={16} aria-hidden="true" /> Novo cargo</button>
    : undefined;
  return (
    <>
      <PageTitle
        title="Equipas e cargos"
        actions={newRole}
        info={(
          <>
            <p>Quem está em cada equipa e que cargos tem, por ano escutista (de setembro a agosto). O ano atual é {o.year}.</p>
            <p>Os cargos são responsabilidades dentro da equipa. Um cargo não dá permissões na aplicação (administração, tesouraria ou documentos): essas são atribuídas à parte, pela administração.</p>
            {!o.can_manage && <p>Só os dirigentes e quem tem essa permissão alteram equipas e cargos.</p>}
          </>
        )}
      />
      <div className="tabs" role="tablist" aria-label="Vistas">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" role="tab" className="tab" aria-selected={view === k} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>
      {view === 'pessoas' ? <People o={o} /> : view === 'cargos' ? <Roles o={o} creating={creating} setCreating={setCreating} /> : <Teams o={o} />}
    </>
  );
}

/** Nomes curtos: primeiro nome; primeiro e último quando há primeiros nomes repetidos. */
function shortNames(list: EqMember[]): string[] {
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
  const count = new Map<string, number>();
  for (const m of list) count.set(first(m.full_name), (count.get(first(m.full_name)) ?? 0) + 1);
  return list.map((m) => {
    const parts = m.full_name.trim().split(/\s+/);
    return (count.get(parts[0]) ?? 0) > 1 && parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
  });
}

function Teams({ o }: { o: EqOverview }) {
  const years = yearOptions(o);
  const [year, setYear] = useParam('ano', o.year);
  const teams = o.teams.filter((t) => !t.archived_at || o.appointments.some((a) => a.team_id === t.id && inYear(a, year)));
  if (!teams.length) {
    return <Empty title="Ainda não há equipas nesta secção."><p className="prose">As equipas são criadas pela administração em Gestão. Depois aparecem aqui, com os seus membros e cargos.</p></Empty>;
  }
  const current = year === o.year;
  return (
    <>
      <YearSelect years={years} value={years.includes(year) ? year : o.year} onChange={setYear} />
      <div className="eq-team-grid">
        {teams.map((t) => {
          const members = current ? o.members.filter((m) => m.status === 'ativo' && m.team_id === t.id) : membersInYear(t.id, year, o.members, o.moves);
          const holders = (kind: RoleKind) => o.appointments
            .filter((a) => a.team_id === t.id && !a.cancelled_at && o.roles.find((r) => r.id === a.role_id)?.kind === kind
              && (current ? appointmentState(a, o.today) === 'ativo' : inYear(a, year)))
            .map((a) => o.members.find((m) => m.membership_id === a.membership_id)?.full_name).filter(Boolean).join(', ');
          const names = shortNames(members);
          const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ` +${names.length - 6}` : '');
          return (
            <Link key={t.id} to={`${BASE}/equipa/${t.id}${year !== o.year ? `?ano=${encodeURIComponent(year)}` : ''}`} className="card eq-team-card" style={{ ['--team' as string]: t.color ?? 'var(--line)' }}>
              <div className="eq-team-head">
                <Emblem team={t} size={36} />
                <div className="grow">
                  <h2>{teamLabel(t)}</h2>
                  {t.motto && <div className="eq-motto">«{t.motto}»</div>}
                </div>
                <ChevronRight size={18} className="row-arrow" aria-hidden="true" />
              </div>
              <div className="eq-team-line"><span className="faint">Guia</span> {holders('guia') || '—'}</div>
              <div className="eq-team-line"><span className="faint">Subguia</span> {holders('subguia') || '—'}</div>
              <div className="eq-team-members">
                <div className="faint">{members.length} {members.length === 1 ? 'membro' : 'membros'}{t.archived_at ? ' · arquivada' : ''}</div>
                {shown && <div className="eq-team-names">{shown}</div>}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function People({ o }: { o: EqOverview }) {
  const [text, setText] = useParam('q');
  const [team, setTeam] = useParam('equipa');
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const list = o.members.filter((m) => (!text || norm(`${m.full_name} ${m.totem ?? ''}`).includes(norm(text)))
    && (!team || (team === 'sem' ? !m.team_id : m.team_id === team)));
  return (
    <>
      <Filters
        active={team ? 1 : 0}
        search={(
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <input type="search" aria-label="Pesquisar" value={text} onChange={(e) => setText(e.target.value)} placeholder="Pesquisar nome ou totem" />
          </label>
        )}
      >
        <select aria-label="Equipa" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Todas as equipas</option>
          {o.teams.filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)}
          <option value="sem">Sem equipa</option>
        </select>
      </Filters>
      <div className="card">
        {list.length ? (
          <ul className="list">
            {list.map((m) => {
              const roles = o.appointments.filter((a) => a.membership_id === m.membership_id && appointmentState(a, o.today) === 'ativo')
                .map((a) => o.roles.find((r) => r.id === a.role_id)?.name).filter(Boolean);
              return (
                <li key={m.membership_id}>
                  <Link to={`${BASE}/pessoa/${m.membership_id}`} className="list-item">
                    <span className="grow">
                      <strong>{m.full_name}</strong>{m.totem ? <span className="faint"> · {m.totem}</span> : null}
                      <br />
                      <span className="faint">{teamLabel(o.teams.find((t) => t.id === m.team_id))}{m.status !== 'ativo' ? ` · ${m.status}` : ''}</span>
                    </span>
                    <span className="eq-badges">{roles.map((r) => <Badge key={r} label={r!} tone="progress" />)}</span>
                    <ChevronRight size={18} className="row-arrow" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title={o.members.length ? 'Ninguém corresponde à pesquisa.' : 'Ainda não há pessoas para mostrar.'} />
        )}
      </div>
    </>
  );
}

function Roles({ o, creating, setCreating }: { o: EqOverview; creating: boolean; setCreating: (v: boolean) => void }) {
  const section = useSectionId();
  const seed = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const active = o.roles.filter((r) => !r.archived_at);
  const archived = o.roles.filter((r) => r.archived_at);
  return (
    <>
      {!o.roles.length && (
        <Empty title="Ainda não há cargos configurados.">
          {o.can_manage ? (
            <>
              <p className="prose">Podes criar os cargos habituais (guia, subguia, secretário, tesoureiro, intendente, cozinheiro e socorrista) e adaptá-los depois, ou criar só os que a secção usa.</p>
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <button type="button" className="btn" disabled={seed.busy} onClick={() => seed.run(() => call('eq_seed_roles', { p_section: section }), 'Cargos habituais criados.')}>Criar cargos habituais</button>
                {!creating && <button type="button" className="btn secondary" onClick={() => setCreating(true)}>Novo cargo</button>}
              </div>
            </>
          ) : <p>Os dirigentes ainda não configuraram os cargos.</p>}
        </Empty>
      )}
      <Result error={seed.error} success={seed.success} />
      {o.can_manage && creating && (
        <section className="card">
          <h2 className="eq-panel-title">Novo cargo</h2>
          <RoleForm onDone={() => setCreating(false)} />
        </section>
      )}
      {active.length > 0 && (
        <div className="card">
          <ul className="list eq-roles">
            {active.map((r) => (
              <li key={r.id}>
                {editing === r.id ? <RoleForm role={r} onDone={() => setEditing(null)} /> : (
                  <div className="eq-role">
                    <div className="grow">
                      <div className="eq-role-head">
                        <h2>{r.name}</h2>
                        <Badge label={r.kind === 'cargo' ? (r.single ? 'Um por equipa' : 'Vários por equipa') : `${ROLE_KIND_LABEL[r.kind]} · um por equipa`} tone="neutral" />
                      </div>
                      <p className="eq-duties">{r.description || <span className="faint">Sem responsabilidades descritas.</span>}</p>
                    </div>
                    {o.can_manage && <button type="button" className="btn ghost" aria-label={`Editar ${r.name}`} onClick={() => setEditing(r.id)}>Editar</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {archived.length > 0 && (
        <details className="card eq-history">
          <summary>Cargos arquivados ({archived.length})</summary>
          <ul className="list">
            {archived.map((r) => (
              <li key={r.id} className="list-item">
                <span className="grow">{r.name}</span>
                {o.can_manage && <ArchiveRole role={r} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ArchiveRole({ role }: { role: EqRole }) {
  const section = useSectionId();
  const act = useAction();
  const archive = !role.archived_at;
  return (
    <>
      <ConfirmButton className="btn ghost" disabled={act.busy} confirmLabel={archive ? 'Arquivar' : 'Reativar'}
        description={archive ? 'O cargo deixa de poder ser atribuído. As nomeações existentes e o histórico mantêm-se.' : undefined}
        onConfirm={() => act.run(() => call('eq_set_role_archived', { p_section: section, p_role: role.id, p_archived: archive }), archive ? 'Cargo arquivado.' : 'Cargo reativado.')}>
        {archive ? 'Arquivar cargo' : 'Reativar'}
      </ConfirmButton>
      {act.error && <Notice kind="error"><p>{act.error}</p></Notice>}
    </>
  );
}

function RoleForm({ role, onDone }: { role?: EqRole; onDone?: () => void }) {
  const section = useSectionId();
  const [name, setName] = useState(role?.name ?? '');
  const [kind, setKind] = useState<RoleKind>(role?.kind ?? 'cargo');
  const [single, setSingle] = useState(role?.single ?? false);
  const [description, setDescription] = useState(role?.description ?? '');
  const [check, setCheck] = useState<string | null>(null);
  const act = useAction();
  const idp = role ? `r-${role.id}` : 'r-novo';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setCheck(null);
    if (!name.trim()) return setCheck('Indica o nome do cargo.');
    const r = await act.run(() => call('eq_save_role', {
      p_section: section, p_role: role?.id ?? null, p_name: name.trim(), p_kind: kind, p_description: description.trim() || null, p_single: single,
    }), role ? 'Cargo guardado.' : 'Cargo criado.');
    if (r.ok) {
      if (role) onDone?.();
      else { setName(''); setDescription(''); setKind('cargo'); setSingle(false); }
    }
  };

  return (
    <form className="eq-role-form" onSubmit={submit} noValidate aria-label={role ? `Editar ${role.name}` : 'Novo cargo'}>
      <div className="grid-2">
        <Field label="Nome" htmlFor={`${idp}-name`}>
          <input id={`${idp}-name`} type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Tipo" htmlFor={`${idp}-kind`} hint={role ? 'O tipo não muda depois de criado.' : undefined}>
          <select id={`${idp}-kind`} value={kind} disabled={!!role} onChange={(e) => setKind(e.target.value as RoleKind)}>
            {(Object.keys(ROLE_KIND_LABEL) as RoleKind[]).map((k) => <option key={k} value={k}>{ROLE_KIND_LABEL[k]}</option>)}
          </select>
        </Field>
      </div>
      {kind === 'cargo' && (
        <label className="eq-check">
          <input type="checkbox" checked={single} onChange={(e) => setSingle(e.target.checked)} />
          <span>Só uma pessoa por equipa de cada vez</span>
        </label>
      )}
      <Field label="Responsabilidades" htmlFor={`${idp}-desc`}>
        <textarea id={`${idp}-desc`} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {check && <Notice kind="error"><p>{check}</p></Notice>}
      <Result error={act.error} success={act.success} />
      <div className="btn-row">
        <button type="submit" className="btn" disabled={act.busy} aria-busy={act.busy}>{role ? 'Guardar' : 'Criar cargo'}</button>
        {onDone && <button type="button" className="btn secondary" onClick={onDone}>{role ? 'Cancelar' : 'Fechar'}</button>}
        {role && <span className="eq-push"><ArchiveRole role={role} /></span>}
      </div>
    </form>
  );
}
