// Caminho da secção: o mapa coletivo, com quem está em cada marco (sem rankings).
// O caminho pessoal está em «Meu progresso › Caminho».
import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, List, Map as MapIcon, X } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useTeams } from '../lib/hooks';
import { fetchMemberProgress, fetchSectionPath, type PathMember } from '../lib/api';
import { MILESTONES, milestoneByKey, type MilestoneKey } from '../lib/caminho';
import { Empty, ErrorBox, Loading, Notice, PageTitle } from '../components/ui';
import { MapLegend, TrailMap, type MapNode } from '../components/caminho/TrailMap';
import { PeopleAtMilestone, PersonSummary } from '../components/caminho/Pieces';
import { MilestoneInfo } from '../components/caminho/Shared';

const KEYS = MILESTONES.map((m) => m.key);
const isKey = (v: string | null): v is MilestoneKey => !!v && (KEYS as string[]).includes(v);

export default function Caminho() {
  const s = useActiveSection();
  const { membership, catalog, isMember, isDirigente, isGuia } = s;
  const [params, setParams] = useSearchParams();
  const modo = params.get('modo') === 'lista' ? 'lista' : 'mapa';
  const team = params.get('equipa') ?? '';
  const personId = params.get('pessoa');
  const panelRef = useRef<HTMLElement>(null);
  const personRef = useRef<HTMLElement>(null);

  const path = useQuery({ queryKey: ['section-path', membership.section_id], queryFn: () => fetchSectionPath(membership.section_id) });
  const teams = useTeams(membership.section_id);
  const visible = path.data?.members ?? [];
  const person = visible.find((m) => m.membership_id === personId);
  const personProgress = useQuery({ queryKey: ['progress', personId], queryFn: () => fetchMemberProgress(personId!), enabled: !!person });

  const set = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace });
  };

  const filtered = useMemo(() => visible.filter((m) => !team || m.team_id === team), [visible, team]);
  const teamOptions = (teams.data ?? []).filter((t) => !t.archived_at && (isDirigente || visible.some((m) => m.team_id === t.id)));
  const filterApplies = !!team && path.data?.scope === 'seccao';
  const selected: MilestoneKey = isKey(params.get('marco'))
    ? (params.get('marco') as MilestoneKey)
    : (KEYS.find((k) => (path.data?.counts[k] ?? 0) > 0) ?? 'conhecimento');

  const nodes = useMemo(() => {
    const out = {} as Record<MilestoneKey, MapNode>;
    for (const m of MILESTONES) {
      if (!m.tracked) {
        out[m.key] = { status: 'info', caption: m.key === 'passagem' ? 'idade e maturidade' : 'antes de entrar' };
        continue;
      }
      const people = filtered.filter((x) => x.milestone === m.key);
      const count = filterApplies ? people.length : (path.data?.counts[m.key] ?? 0);
      out[m.key] = {
        status: 'neutro',
        count,
        people: people.map((x) => ({ id: x.membership_id, name: x.full_name })),
        caption: count ? `${count} pioneiro${count === 1 ? '' : 's'}` : 'ninguém',
      };
    }
    return out;
  }, [filtered, filterApplies, path.data]);

  const select = (k: MilestoneKey) => {
    set({ marco: k, pessoa: null }, true);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: false }));
  };
  const pick = (id: string) => set({ pessoa: id });
  useEffect(() => {
    if (person) personRef.current?.focus();
  }, [person]);

  if (path.isLoading) return <Loading />;
  if (path.error) return <ErrorBox error={path.error} retry={path.refetch} />;

  const teamName = (id: string | null) => teams.data?.find((t) => t.id === id)?.name ?? 'Sem equipa';
  const peopleHere = filtered.filter((x) => x.milestone === selected);
  const hiddenHere = team ? 0 : Math.max(0, (path.data?.counts[selected] ?? 0) - visible.filter((x) => x.milestone === selected).length);
  const m = milestoneByKey[selected];
  const total = path.data?.total ?? 0;

  return (
    <div className="caminho-page">
      <PageTitle
        title="Caminho da secção"
        subtitle="Quem está em cada marco do Sistema de Progresso. Cada pioneiro escolhe os seus trilhos e caminha ao seu ritmo — não é uma classificação."
      />

      <div className="caminho-controls">
        {isMember ? (
          <Link to="/meu-progresso?vista=caminho" className="btn secondary">O meu caminho <ArrowRight size={16} aria-hidden="true" /></Link>
        ) : <span />}
        <div className="row">
          {teamOptions.length > 1 && (
            <label className="inline-field">
              <span>Equipa</span>
              <select value={team} onChange={(e) => set({ equipa: e.target.value || null, pessoa: null }, true)}>
                <option value="">Todas</option>
                {teamOptions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          <div className="segmented" role="radiogroup" aria-label="Apresentação">
            <label className="segment">
              <input type="radio" name="modo" checked={modo === 'mapa'} onChange={() => set({ modo: null }, true)} />
              <MapIcon size={16} aria-hidden="true" /> <span>Mapa</span>
            </label>
            <label className="segment">
              <input type="radio" name="modo" checked={modo === 'lista'} onChange={() => set({ modo: 'lista' }, true)} />
              <List size={16} aria-hidden="true" /> <span>Lista</span>
            </label>
          </div>
        </div>
      </div>

      {total === 0 && (
        <div className="card">
          <Empty title="Ainda não há pioneiros ativos na secção.">
            <p>O caminho mostra quem está em cada marco quando houver pioneiros e guias com entrada confirmada.</p>
            {s.isAdmin && (
              <div className="btn-row" style={{ justifyContent: 'center' }}>
                <Link to="/gestao/equipas" className="btn secondary">Criar equipas</Link>
                <Link to="/gestao/convites" className="btn">Convidar elementos</Link>
              </div>
            )}
          </Empty>
        </div>
      )}
      {total > 0 && path.data?.scope !== 'seccao' && (
        <Notice kind="info">
          <p>
            {isGuia
              ? 'Vês os nomes da tua equipa; das outras equipas só aparece quantos estão em cada marco.'
              : 'Vês quantos pioneiros estão em cada marco; os nomes só aparecem a quem acompanha o seu percurso.'}
          </p>
        </Notice>
      )}

      {modo === 'mapa' ? (
        <div className="caminho-layout">
          <section className="card map-card" aria-label="Mapa do caminho">
            <TrailMap nodes={nodes} selected={selected} onSelect={select} title="Caminho da secção: quantos pioneiros estão em cada marco" />
            <MapLegend />
          </section>
          <section className="card milestone-panel" ref={panelRef} tabIndex={-1} aria-labelledby="marco-titulo">
            <p className="faint" style={{ margin: 0 }}>Marco {KEYS.indexOf(selected) + 1} de {KEYS.length}</p>
            <h2 id="marco-titulo">{m.name}</h2>
            {m.tracked && (
              <div className="personal-block">
                <h3>Neste momento</h3>
                <PeopleAtMilestone people={peopleHere} hidden={hiddenHere} onPick={pick} teamName={teamName} />
              </div>
            )}
            <MilestoneInfo k={selected} />
          </section>
        </div>
      ) : (
        <ol className="milestone-list" aria-label="Marcos do caminho">
          {MILESTONES.map((mm, i) => {
            const n = nodes[mm.key];
            const people = filtered.filter((x) => x.milestone === mm.key);
            const hidden = team ? 0 : Math.max(0, (path.data?.counts[mm.key] ?? 0) - visible.filter((x) => x.milestone === mm.key).length);
            return (
              <li key={mm.key} className={`card ml-${n.status}`}>
                <details open={mm.key === selected}>
                  <summary>
                    <span className="ml-num" aria-hidden="true">{i + 1}</span>
                    <span className="grow">
                      <strong>{mm.name}</strong>
                      <br />
                      <span className="faint">{n.caption}</span>
                    </span>
                  </summary>
                  {mm.tracked && <div className="personal-block"><PeopleAtMilestone people={people} hidden={hidden} onPick={pick} teamName={teamName} /></div>}
                  <MilestoneInfo k={mm.key} />
                </details>
              </li>
            );
          })}
        </ol>
      )}

      {person && (
        <section className="card person-panel" ref={personRef} tabIndex={-1} aria-label={`Resumo do percurso de ${person.full_name}`}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>Resumo do percurso</h2>
            <button type="button" className="btn ghost icon-btn" aria-label="Fechar resumo" onClick={() => set({ pessoa: null }, true)}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {personProgress.isLoading ? <Loading rows={2} /> : personProgress.error || !personProgress.data ? (
            <ErrorBox error={personProgress.error ?? 'Sem acesso a este percurso.'} />
          ) : (
            <>
              <PersonSummary member={person} progress={personProgress.data} catalog={catalog} canOpen={(isDirigente || isGuia) && !person.is_me} self={person.is_me} />
              <Link to={person.is_me ? '/meu-progresso' : `/meu-progresso?pioneiro=${person.membership_id}`} className="btn ghost" style={{ marginTop: 6 }}>
                {person.is_me ? 'Abrir o meu progresso' : 'Consultar progresso por áreas'} <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </>
          )}
        </section>
      )}
    </div>
  );
}

export type { PathMember };
