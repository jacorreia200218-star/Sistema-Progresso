import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, List, Map as MapIcon, X } from 'lucide-react';
import { useActiveSection } from '../lib/session';
import { useProgress, useTeams } from '../lib/hooks';
import { fetchMemberProgress, fetchSectionPath, type PathMember } from '../lib/api';
import {
  ADHESION_KNOWLEDGE, memberPosition, MILESTONES, milestoneByKey, stageCycle, stageStatusFor, STATE_LABEL,
  type MilestoneKey, type PositionState,
} from '../lib/caminho';
import { nextAction } from '../lib/progress';
import type { Catalog, MemberProgress } from '../lib/types';
import { Empty, ErrorBox, Loading, Notice, PageTitle } from '../components/ui';
import { MapLegend, TrailMap, type MapNode } from '../components/caminho/TrailMap';
import { AreaMarkers, PeopleAtMilestone, PersonalAtMilestone, PersonSummary } from '../components/caminho/Pieces';

const KEYS = MILESTONES.map((m) => m.key);
const isKey = (v: string | null): v is MilestoneKey => !!v && (KEYS as string[]).includes(v);

function shortState(state: PositionState): string {
  const map: Partial<Record<PositionState, string>> = {
    em_adesao: 'em adesão', perfil_tracado: 'perfil traçado', aguarda_promessa: 'aguarda Promessa', aguarda_etapa: 'Promessa feita',
    em_curso: 'em curso', requisitos_cumpridos: 'requisitos cumpridos', em_validacao: 'em validação',
    concluida: 'concluída', reconhecida: 'reconhecida', etapas_concluidas: 'etapas concluídas', anilha_atribuida: 'anilha atribuída',
  };
  return map[state] ?? STATE_LABEL[state].label;
}

function personalNodes(p: MemberProgress, catalog: Catalog): Record<MilestoneKey, MapNode> {
  const pos = memberPosition(p, catalog);
  const idx = KEYS.indexOf(pos.milestone);
  const out = {} as Record<MilestoneKey, MapNode>;
  MILESTONES.forEach((m, i) => {
    const stage = ['conhecimento', 'vontade', 'construcao'].includes(m.key) ? stageStatusFor(m.key, p, catalog) : null;
    const phases = stage ? stageCycle(stage.summary, catalog.areas.length) : undefined;
    if (!m.tracked) out[m.key] = { status: 'info', caption: m.key === 'passagem' ? 'idade e maturidade' : 'antes de entrar' };
    else if (i === idx) out[m.key] = { status: 'atual', caption: `estás aqui · ${shortState(pos.state)}`, phases };
    else if (i < idx) out[m.key] = { status: 'feito', caption: stage && stage.state !== 'nao_iniciada' ? shortState(stage.state as PositionState) : 'feito', phases };
    else out[m.key] = { status: 'por_vir', phases };
  });
  return out;
}

function MilestoneInfo({ k }: { k: MilestoneKey }) {
  const m = milestoneByKey[k];
  return (
    <div className="stack">
      <p>{m.summary}</p>
      <div className="grid-2">
        <div>
          <h4>O que é necessário</h4>
          <ul className="tight">{m.needed.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
        <div>
          <h4>Como se valida</h4>
          <p>{m.validation}</p>
          <h4>O que permite avançar</h4>
          <p>{m.advance}</p>
        </div>
      </div>
      {k === 'inicio_pista' && (
        <details className="card flat">
          <summary>Conhecimentos de adesão da III Secção (p. 6)</summary>
          <h4>Adesão ao movimento</h4>
          <ul className="tight">{ADHESION_KNOWLEDGE.movimento.map((x) => <li key={x}>{x}</li>)}</ul>
          <h4>Adesão à secção</h4>
          <ul className="tight">{ADHESION_KNOWLEDGE.seccao.map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="faint">{ADHESION_KNOWLEDGE.nota}</p>
        </details>
      )}
      {m.note && <p className="faint">{m.note}</p>}
      <p className="faint">Manual do Dirigente, {m.pages}.</p>
    </div>
  );
}

export default function Caminho() {
  const s = useActiveSection();
  const { membership, catalog, isMember, isDirigente, isGuia } = s;
  const [params, setParams] = useSearchParams();
  const vista = isMember && params.get('vista') !== 'seccao' ? 'meu' : 'seccao';
  const modo = params.get('modo') === 'lista' ? 'lista' : 'mapa';
  const team = params.get('equipa') ?? '';
  const personId = params.get('pessoa');
  const panelRef = useRef<HTMLElement>(null);
  const personRef = useRef<HTMLElement>(null);

  const mine = useProgress(isMember ? membership.id : undefined);
  const path = useQuery({ queryKey: ['section-path', membership.section_id], queryFn: () => fetchSectionPath(membership.section_id) });
  const teams = useTeams(membership.section_id);
  const visible = path.data?.members ?? [];
  const person = visible.find((m) => m.membership_id === personId);
  const personProgress = useQuery({
    queryKey: ['progress', personId],
    queryFn: () => fetchMemberProgress(personId!),
    enabled: !!person,
  });

  const set = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace });
  };

  const myPos = mine.data ? memberPosition(mine.data, catalog) : null;
  const filtered = useMemo(() => visible.filter((m) => !team || m.team_id === team), [visible, team]);
  const teamOptions = (teams.data ?? []).filter((t) => !t.archived_at && (isDirigente || visible.some((m) => m.team_id === t.id)));
  const filterApplies = !!team && path.data?.scope === 'seccao';

  const selected: MilestoneKey = isKey(params.get('marco'))
    ? (params.get('marco') as MilestoneKey)
    : vista === 'meu' && myPos
      ? myPos.milestone
      : (KEYS.find((k) => (path.data?.counts[k] ?? 0) > 0) ?? 'conhecimento');

  const nodes = useMemo(() => {
    if (vista === 'meu' && mine.data) return personalNodes(mine.data, catalog);
    const out = {} as Record<MilestoneKey, MapNode>;
    for (const m of MILESTONES) {
      if (!m.tracked) {
        out[m.key] = { status: 'info', caption: m.key === 'passagem' ? 'idade e maturidade' : 'antes de entrar' };
        continue;
      }
      const people = filtered.filter((x) => x.milestone === m.key);
      const count = filterApplies ? people.length : (path.data?.counts[m.key] ?? 0);
      out[m.key] = {
        status: 'neutro' as const,
        count,
        people: people.map((x) => ({ id: x.membership_id, name: x.full_name })),
        caption: count ? `${count} pioneiro${count === 1 ? '' : 's'}` : 'ninguém',
      };
    }
    return out;
  }, [vista, mine.data, catalog, filtered, filterApplies, path.data]);

  // Ao escolher um marco ou um pioneiro, leva o foco para o painel (útil no telemóvel e com leitor de ecrã).
  const select = (k: MilestoneKey) => {
    set({ marco: k, pessoa: null }, true);
    requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: false }));
  };
  const pick = (id: string) => set({ pessoa: id });
  useEffect(() => {
    if (person) personRef.current?.focus();
  }, [person]);

  if ((isMember && mine.isLoading) || path.isLoading) return <Loading />;
  if (mine.error || path.error) return <ErrorBox error={mine.error ?? path.error} retry={() => { mine.refetch(); path.refetch(); }} />;

  const teamName = (id: string | null) => teams.data?.find((t) => t.id === id)?.name ?? 'Sem equipa';
  const peopleHere = filtered.filter((x) => x.milestone === selected);
  const hiddenHere = filterApplies || team ? 0 : Math.max(0, (path.data?.counts[selected] ?? 0) - visible.filter((x) => x.milestone === selected).length);
  const action = mine.data ? nextAction(catalog, mine.data) : null;
  const m = milestoneByKey[selected];
  const total = path.data?.total ?? 0;

  return (
    <div className="caminho-page">
      <PageTitle
        title="Caminho"
        subtitle="O Sistema de Progresso como um jogo de pistas: cada pioneiro escolhe os seus trilhos e oportunidades e caminha ao seu ritmo. Não é uma classificação."
      />

      <div className="caminho-controls">
        {isMember && (
          <div className="tabs" role="tablist" aria-label="Vista do caminho">
            <button type="button" role="tab" className="tab" aria-selected={vista === 'meu'} onClick={() => set({ vista: null, marco: null, pessoa: null })}>O meu caminho</button>
            <button type="button" role="tab" className="tab" aria-selected={vista === 'seccao'} onClick={() => set({ vista: 'seccao', marco: null, pessoa: null })}>Caminho da secção</button>
          </div>
        )}
        <div className="row">
          {vista === 'seccao' && teamOptions.length > 1 && (
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
              <MapIcon size={18} aria-hidden="true" /> <span>Mapa</span>
            </label>
            <label className="segment">
              <input type="radio" name="modo" checked={modo === 'lista'} onChange={() => set({ modo: 'lista' }, true)} />
              <List size={18} aria-hidden="true" /> <span>Lista</span>
            </label>
          </div>
        </div>
      </div>

      {vista === 'meu' && mine.data && myPos && (
        <section className="card caminho-hero" aria-label="Onde estou">
          <div className="row between">
            <div>
              <p className="faint" style={{ margin: 0 }}>Estás em</p>
              <h2 style={{ margin: 0 }}>{milestoneByKey[myPos.milestone].name}</h2>
              <p style={{ margin: '4px 0 0' }}>{STATE_LABEL[myPos.state].label}</p>
            </div>
            {action?.to && <Link to={action.to} className="btn">{action.title} <ArrowRight size={18} aria-hidden="true" /></Link>}
          </div>
          <AreaMarkers progress={mine.data} catalog={catalog} />
        </section>
      )}

      {vista === 'seccao' && total === 0 && (
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
      {vista === 'seccao' && total > 0 && path.data?.scope !== 'seccao' && (
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
            <TrailMap
              nodes={nodes}
              selected={selected}
              onSelect={select}
              title={vista === 'meu' ? 'O meu caminho: marcos do Sistema de Progresso' : 'Caminho da secção: quantos pioneiros estão em cada marco'}
            />
            <MapLegend />
          </section>

          <section className="card milestone-panel" ref={panelRef} tabIndex={-1} aria-labelledby="marco-titulo">
            <p className="faint" style={{ margin: 0 }}>Marco {KEYS.indexOf(selected) + 1} de {KEYS.length}</p>
            <h2 id="marco-titulo">{m.name}</h2>
            {vista === 'meu' && mine.data && (
              <div className="personal-block">
                <PersonalAtMilestone k={selected} progress={mine.data} catalog={catalog} self />
                {myPos?.milestone === selected && action?.to && (
                  <Link to={action.to} className="btn" style={{ marginTop: 10 }}>{action.title} <ArrowRight size={18} aria-hidden="true" /></Link>
                )}
              </div>
            )}
            {vista === 'seccao' && m.tracked && (
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
                      <span className="faint">{n.caption ?? (n.status === 'feito' ? 'concluído' : n.status === 'por_vir' ? 'por vir' : '')}</span>
                    </span>
                  </summary>
                  {vista === 'meu' && mine.data && <div className="personal-block"><PersonalAtMilestone k={mm.key} progress={mine.data} catalog={catalog} self /></div>}
                  {vista === 'seccao' && mm.tracked && (
                    <div className="personal-block"><PeopleAtMilestone people={people} hidden={hidden} onPick={pick} teamName={teamName} /></div>
                  )}
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
          {personProgress.isLoading ? <Loading /> : personProgress.error || !personProgress.data ? (
            <ErrorBox error={personProgress.error ?? 'Sem acesso a este percurso.'} />
          ) : (
            <PersonSummary member={person} progress={personProgress.data} catalog={catalog} canOpen={(isDirigente || isGuia) && !person.is_me} self={person.is_me} />
          )}
        </section>
      )}
    </div>
  );
}

export type { PathMember };
