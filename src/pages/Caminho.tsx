// Caminho da secção: onde está cada pessoa, para facilitar o apoio. Sem rankings:
// as pessoas aparecem por ordem alfabética no marco em que estão.
import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useTeams } from '../lib/hooks';
import { fetchSectionPath, type PathMember } from '../lib/api';
import { MILESTONES, milestoneByKey, type MilestoneKey } from '../lib/caminho';
import { Avatar, Empty, ErrorBox, Loading, PageTitle } from '../components/ui';
import { SidePanel } from '../components/nav';
import { PeopleRow, Track, type TrackStep } from '../components/caminho/Track';
import { PersonPanelBody } from '../components/caminho/PersonPanel';
import { MilestoneInfo } from '../components/caminho/Shared';

const KEYS = MILESTONES.map((m) => m.key);
const isKey = (v: string | null): v is MilestoneKey => !!v && (KEYS as string[]).includes(v);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const byName = (a: PathMember, b: PathMember) => a.full_name.localeCompare(b.full_name, 'pt', { sensitivity: 'base' });
const MAX_AVATARS = 5;

export default function Caminho() {
  const s = useActiveSection();
  const { membership, catalog, isMember, isDirigente } = s;
  const [params, setParams] = useSearchParams();
  const team = params.get('equipa') ?? '';
  const query = params.get('q') ?? '';
  const personId = params.get('pessoa');
  const openList = isKey(params.get('marco')) ? (params.get('marco') as MilestoneKey) : null;

  const path = useQuery({ queryKey: ['section-path', membership.section_id], queryFn: () => fetchSectionPath(membership.section_id) });
  const teams = useTeams(membership.section_id);

  const set = useCallback((patch: Record<string, string | null>, replace = true) => {
    // Parte sempre do endereço atual: duas alterações seguidas (pesquisa e equipa) não se anulam.
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace });
  }, [setParams]);
  const closePanel = useCallback(() => set({ pessoa: null, marco: null }), [set]);

  const visible = useMemo(() => [...(path.data?.members ?? [])].sort(byName), [path.data]);
  const filtered = useMemo(
    () => visible.filter((m) => (!team || m.team_id === team) && (!query || norm(m.full_name).includes(norm(query.trim())))),
    [visible, team, query],
  );
  const teamOptions = (teams.data ?? []).filter((t) => !t.archived_at && (isDirigente || visible.some((m) => m.team_id === t.id)));
  const teamName = (id: string | null) => teams.data?.find((t) => t.id === id)?.name ?? 'Sem equipa';
  const filtering = !!team || !!query;

  if (path.isLoading) return <Loading />;
  if (path.error) return <ErrorBox error={path.error} retry={path.refetch} />;
  const total = path.data?.total ?? 0;
  const counts = path.data?.counts ?? {};

  const steps = {} as Record<MilestoneKey, TrackStep>;
  for (const m of MILESTONES) {
    if (!m.tracked) {
      steps[m.key] = { status: 'info', caption: m.key === 'passagem' ? 'Idade e maturidade' : 'Antes de entrar' };
      continue;
    }
    const people = filtered.filter((x) => x.milestone === m.key);
    const known = visible.filter((x) => x.milestone === m.key).length;
    const hidden = filtering ? 0 : Math.max(0, (counts[m.key] ?? 0) - known);
    const n = filtering ? people.length : counts[m.key] ?? 0;
    steps[m.key] = {
      status: n ? 'ocupado' : 'neutro',
      caption: n ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'}` : 'Ninguém',
      content: (
        <PeopleRow people={people} max={MAX_AVATARS} hidden={hidden} teamName={teamName}
          onPick={(id) => set({ pessoa: id, marco: null })} onMore={() => set({ marco: m.key, pessoa: null })} />
      ),
    };
  }

  const person = personId ? visible.find((m) => m.membership_id === personId) : undefined;
  const listPeople = openList ? filtered.filter((x) => x.milestone === openList) : [];

  return (
    <div className={`caminho-page ${person || openList ? 'with-panel' : ''}`}>
      <PageTitle title="Caminho da secção" />

      {total === 0 ? (
        <div className="card">
          <Empty title="Ainda não há pioneiros ativos na secção.">
            {s.isAdmin && (
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <Link to="/gestao/equipas" className="btn secondary">Criar equipas</Link>
                <Link to="/gestao/convites" className="btn">Convidar elementos</Link>
              </div>
            )}
          </Empty>
        </div>
      ) : (
        <div className="caminho-grid">
          <div>
            {visible.length > 1 && (
              <div className="track-tools">
                <label className="search-field">
                  <Search size={16} aria-hidden="true" />
                  <span className="sr-only">Pesquisar por nome</span>
                  <input type="search" placeholder="Pesquisar por nome" value={query} onChange={(e) => set({ q: e.target.value || null })} />
                </label>
                {teamOptions.length > 1 && (
                  <label className="inline-field">
                    <span className="sr-only">Equipa</span>
                    <select aria-label="Equipa" value={team} onChange={(e) => set({ equipa: e.target.value || null, pessoa: null })}>
                      <option value="">Todas as equipas</option>
                      {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
            {path.data?.scope !== 'seccao' && (
              <p className="faint">{isMember && path.data?.scope === 'proprio' ? 'Vês o teu nome; dos outros pioneiros, quantos estão em cada marco.' : 'Vês os nomes da tua equipa; das outras, quantos estão em cada marco.'}</p>
            )}
            {filtering && !filtered.length && <p className="faint" role="status">Ninguém corresponde à pesquisa.</p>}
            <section className="card map-card" aria-label="Mapa do caminho da secção">
              <Track steps={steps} label="Marcos do caminho e quem está em cada um" />
            </section>
            <details className="more">
              <summary>Sobre os marcos do caminho</summary>
              {MILESTONES.filter((m) => m.tracked).map((m) => (
                <details key={m.key} className="more-inner">
                  <summary>{m.name}</summary>
                  <MilestoneInfo k={m.key} />
                </details>
              ))}
            </details>
            <p className="row" style={{ marginTop: 8 }}>
              {isMember && <Link to="/meu-progresso?vista=caminho" className="btn ghost">O meu percurso</Link>}
              <Link to="/trilhos" className="btn ghost">Ver trilhos</Link>
            </p>
          </div>

          {person && (
            <SidePanel title="Percurso" onClose={closePanel} labelledBy="painel-pessoa">
              <PersonPanelBody key={person.membership_id} member={person} catalog={catalog} teamName={teamName} />
            </SidePanel>
          )}
          {!person && openList && (
            <SidePanel title={`${milestoneByKey[openList].name} · ${listPeople.length}`} onClose={closePanel} labelledBy="painel-marco">
              <ul className="people-list">
                {listPeople.map((p) => (
                  <li key={p.membership_id}>
                    <button type="button" className="person" onClick={() => set({ pessoa: p.membership_id, marco: null })}>
                      <Avatar name={p.full_name} photoPath={p.photo_path} />
                      <span className="grow">
                        <strong>{p.full_name}{p.is_me ? ' (tu)' : ''}</strong>
                        <br />
                        <span className="faint">{teamName(p.team_id)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </SidePanel>
          )}
        </div>
      )}
    </div>
  );
}

export type { PathMember };
