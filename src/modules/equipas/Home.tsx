// Página inicial do módulo: equipas (por ano escutista), pessoas e cargos.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Search, Users } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { Badge, ConfirmButton, Empty, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import {
  appointmentState, inYear, membersInYear, ROLE_KIND_LABEL, useEquipas, useSectionId, yearOptions,
  type EqOverview, type EqRole, type RoleKind,
} from './data';
import { BASE, Emblem, Result, teamLabel, useParam, YearSelect } from './parts';

const VIEWS = [['equipas', 'Equipas'], ['pessoas', 'Pessoas'], ['cargos', 'Cargos']] as const;

export default function Home() {
  const q = useEquipas();
  const [view, setView] = useParam('vista', 'equipas');
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const o = q.data;
  return (
    <>
      <PageTitle title="Equipas e cargos" subtitle={`Ano escutista ${o.year} · quem está em cada equipa e que cargos tem.`} />
      <div className="tabs" role="tablist" aria-label="Vistas">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" role="tab" className="tab" aria-selected={view === k} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>
      {view === 'pessoas' ? <People o={o} /> : view === 'cargos' ? <Roles o={o} /> : <Teams o={o} />}
    </>
  );
}

function Teams({ o }: { o: EqOverview }) {
  const years = yearOptions(o);
  const [year, setYear] = useParam('ano', o.year);
  const teams = o.teams.filter((t) => !t.archived_at || o.appointments.some((a) => a.team_id === t.id && inYear(a, year)));
  if (!teams.length) {
    return <Empty title="Ainda não há equipas nesta secção."><p className="prose">As equipas são criadas pela administração em Gestão. Depois aparecem aqui, com os seus membros e cargos.</p></Empty>;
  }
  return (
    <>
      <YearSelect years={years} value={years.includes(year) ? year : o.year} onChange={setYear} />
      <div className="eq-team-grid">
        {teams.map((t) => {
          const current = year === o.year;
          const members = current ? o.members.filter((m) => m.status === 'ativo' && m.team_id === t.id) : membersInYear(t.id, year, o.members, o.moves);
          const lead = (kind: RoleKind) => {
            const list = o.appointments.filter((a) => a.team_id === t.id && !a.cancelled_at && o.roles.find((r) => r.id === a.role_id)?.kind === kind
              && (current ? appointmentState(a, o.today) === 'ativo' : inYear(a, year)));
            return list.map((a) => o.members.find((m) => m.membership_id === a.membership_id)?.full_name).filter(Boolean).join(', ');
          };
          const guia = lead('guia');
          const sub = lead('subguia');
          return (
            <Link key={t.id} to={`${BASE}/equipa/${t.id}${year !== o.year ? `?ano=${encodeURIComponent(year)}` : ''}`} className="card eq-team-card" style={{ ['--team' as string]: t.color ?? 'var(--line)' }}>
              <Emblem team={t} />
              <h2>{teamLabel(t)}</h2>
              {t.motto && <p className="eq-motto">«{t.motto}»</p>}
              <dl className="eq-leads">
                <div><dt>Guia</dt><dd>{guia || '—'}</dd></div>
                <div><dt>Subguia</dt><dd>{sub || '—'}</dd></div>
              </dl>
              <span className="faint"><Users size={14} aria-hidden="true" /> {members.length} {members.length === 1 ? 'membro' : 'membros'}{t.archived_at ? ' · arquivada' : ''}</span>
            </Link>
          );
        })}
      </div>
      {!o.can_manage && <p className="faint prose">Vês os membros da tua equipa e quem tem cargos em cada equipa. A gestão é feita pelos dirigentes e por quem tem essa permissão.</p>}
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
      <div className="eq-filters">
        <div className="field">
          <label htmlFor="eq-q">Pesquisar</label>
          <div className="eq-search">
            <Search size={16} aria-hidden="true" />
            <input id="eq-q" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Nome ou totem" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="eq-f-team">Equipa</label>
          <select id="eq-f-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Todas</option>
            {o.teams.filter((t) => !t.archived_at).map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)}
            <option value="sem">Sem equipa</option>
          </select>
        </div>
      </div>
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

function Roles({ o }: { o: EqOverview }) {
  const section = useSectionId();
  const seed = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const active = o.roles.filter((r) => !r.archived_at);
  const archived = o.roles.filter((r) => r.archived_at);
  return (
    <>
      <Notice kind="info">
        <p className="prose">Os cargos são responsabilidades dentro da equipa. Um cargo não dá permissões na aplicação (administração, tesouraria ou documentos): essas são atribuídas à parte, pela administração.</p>
      </Notice>
      {!o.roles.length && (
        <Empty title="Ainda não há cargos configurados.">
          {o.can_manage ? (
            <>
              <p className="prose">Podes criar os cargos habituais (guia, subguia, secretário, tesoureiro, intendente, cozinheiro e socorrista) e adaptá-los depois, ou criar só os que a secção usa.</p>
              <button type="button" className="btn" disabled={seed.busy} onClick={() => seed.run(() => call('eq_seed_roles', { p_section: section }), 'Cargos habituais criados.')}>Criar cargos habituais</button>
            </>
          ) : <p>Os dirigentes ainda não configuraram os cargos.</p>}
        </Empty>
      )}
      <Result error={seed.error} success={seed.success} />
      {active.length > 0 && (
        <ul className="eq-roles">
          {active.map((r) => (
            <li key={r.id} className="card">
              {editing === r.id ? <RoleForm role={r} onDone={() => setEditing(null)} /> : (
                <>
                  <div className="row">
                    <h2 className="grow">{r.name}</h2>
                    <Badge label={r.kind === 'cargo' ? (r.single ? 'Um por equipa' : 'Vários por equipa') : `${ROLE_KIND_LABEL[r.kind]} · um por equipa`} tone="neutral" />
                  </div>
                  <p className="prose eq-duties">{r.description || <span className="faint">Sem responsabilidades descritas.</span>}</p>
                  {o.can_manage && (
                    <div className="btn-row">
                      <button type="button" className="btn secondary" onClick={() => setEditing(r.id)}>Editar</button>
                      <ArchiveRole role={r} />
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {o.can_manage && (
        <div className="card">
          <h2>Novo cargo</h2>
          <RoleForm />
        </div>
      )}
      {archived.length > 0 && (
        <details className="card">
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
        {archive ? 'Arquivar' : 'Reativar'}
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
    <form onSubmit={submit} noValidate aria-label={role ? `Editar ${role.name}` : 'Novo cargo'}>
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
        {role && <button type="button" className="btn secondary" onClick={onDone}>Cancelar</button>}
      </div>
    </form>
  );
}
