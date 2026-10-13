// Vista por equipa: alternativa compacta ao mapa. Pessoas por ordem alfabética,
// etapa e o estado de cada área FACEIS na etapa em curso. Com uma área escolhida,
// agrupa as pessoas pelo trilho dessa área — para planear atividades em conjunto.
// Sem pontuações, rankings, percentagens nem ordenação por progresso.
import { useQuery } from '@tanstack/react-query';
import { Check, CircleDashed, Clock, Compass, RotateCcw, Send } from 'lucide-react';
import { fetchSectionChoices, fetchSectionRequests, fetchSectionStagePaths, type PathMember } from '../../lib/api';
import { milestoneByKey, type MilestoneKey } from '../../lib/caminho';
import { activeRequest, isValidated } from '../../lib/progress';
import { STATUS_TEXT, type ChecklistStatus } from '../../lib/meuprogresso';
import type { Catalog, CatalogArea, CatalogTrail, StageChoice, StagePath, TrailRequest } from '../../lib/types';
import { ErrorBox, Loading } from '../ui';

const ICON: Record<ChecklistStatus, typeof Check> = {
  por_escolher: CircleDashed, em_negociacao: Clock, por_concluir: Compass, submetido: Send, revisao: RotateCcw, validado: Check,
};

interface Cell { status: ChecklistStatus; trail?: CatalogTrail }

function cellFor(area: CatalogArea, path: StagePath | undefined, choices: StageChoice[], requests: TrailRequest[], catalog: Catalog): Cell | null {
  if (!path) return null;
  const c = choices.find((x) => x.stage_path_id === path.id && x.area_code === area.code && (x.status === 'confirmada' || x.status === 'proposta'));
  if (!c) return { status: 'por_escolher' };
  const trail = catalog.trailById.get(c.trail_id);
  if (c.status === 'proposta') return { status: 'em_negociacao', trail };
  const r = activeRequest(requests, c.trail_key);
  if (isValidated(r)) return { status: 'validado', trail };
  if (r?.status === 'devolvido') return { status: 'revisao', trail };
  if (r?.status === 'submetido' || r?.status === 'em_revisao') return { status: 'submetido', trail };
  return { status: 'por_concluir', trail };
}

export function TeamView({ people, catalog, areaCode, teamName, onPick, sectionId }: {
  people: PathMember[];
  catalog: Catalog;
  areaCode: string;
  teamName: (id: string | null) => string;
  onPick: (id: string) => void;
  sectionId: string;
}) {
  const ids = people.map((p) => p.membership_id);
  const key = ids.join(',');
  // Os dados chegam já limitados pelas permissões (RLS): cada um só vê quem pode acompanhar.
  const paths = useQuery({ queryKey: ['paths', key], queryFn: () => fetchSectionStagePaths(ids), enabled: ids.length > 0 });
  const choices = useQuery({ queryKey: ['choices', key, 'todas'], queryFn: () => fetchSectionChoices(ids), enabled: ids.length > 0 });
  const requests = useQuery({ queryKey: ['section-requests', sectionId, 'all'], queryFn: () => fetchSectionRequests(sectionId), enabled: ids.length > 0 });
  if (!people.length) return <p className="faint">Ninguém para mostrar.</p>;
  if (paths.isLoading || choices.isLoading || requests.isLoading) return <Loading rows={2} />;
  const error = paths.error ?? choices.error ?? requests.error;
  if (error) return <ErrorBox error={error} retry={() => { paths.refetch(); choices.refetch(); requests.refetch(); }} />;

  const rows = people.map((p) => {
    const open = (paths.data ?? []).find((x) => x.membership_id === p.membership_id && x.status === 'em_curso');
    const mine = (choices.data ?? []).filter((c) => c.membership_id === p.membership_id);
    const reqs = (requests.data ?? []).filter((r) => r.membership_id === p.membership_id);
    const cells = Object.fromEntries(catalog.areas.map((a) => [a.code, cellFor(a, open, mine, reqs, catalog)])) as Record<string, Cell | null>;
    return { p, cells };
  });
  const area = catalog.areas.find((a) => a.code === areaCode);
  // Agrupado por equipa (equipas por nome; pessoas por ordem alfabética dentro de cada uma).
  const teamGroups = [...new Set(rows.map((r) => teamName(r.p.team_id)))].sort((a, b) => a.localeCompare(b, 'pt'))
    .map((team) => ({ team, rows: rows.filter((r) => teamName(r.p.team_id) === team) }));

  if (area) {
    // Agrupado pelo trilho escolhido nesta área (os grupos seguem a ordem do catálogo).
    const groups = [
      ...area.catalog_trails.map((t) => ({ label: t.name, list: rows.filter((r) => r.cells[area.code]?.trail?.id === t.id) })),
      { label: 'Por escolher', list: rows.filter((r) => r.cells[area.code]?.status === 'por_escolher') },
      { label: 'Sem etapa em curso', list: rows.filter((r) => !r.cells[area.code]) },
    ].filter((g) => g.list.length);
    return (
      <div className="team-groups">
        {groups.map((g) => (
          <section key={g.label} className="card" aria-label={`${area.name}: ${g.label}`}>
            <h3 style={{ margin: '0 0 6px' }}>{g.label} <span className="faint">· {g.list.length}</span></h3>
            <ul className="list">
              {g.list.map(({ p, cells }) => {
                const c = cells[area.code];
                const Icon = c ? ICON[c.status] : CircleDashed;
                return (
                  <li key={p.membership_id}>
                    <button type="button" className="list-item person-line" onClick={() => onPick(p.membership_id)}>
                      <span className="grow"><strong>{p.full_name}{p.is_me ? ' (tu)' : ''}</strong> <span className="faint">· {teamName(p.team_id)}</span></span>
                      {c && c.status !== 'por_escolher' && <span className={`faceis-state fs-${c.status}`}><Icon size={14} aria-hidden="true" /> {STATUS_TEXT[c.status]}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="card team-table-wrap">
      <table className="team-table">
        <caption className="sr-only">Pessoas por ordem alfabética, etapa e estado de cada área FACEIS na etapa em curso</caption>
        <thead>
          <tr>
            <th scope="col">Pessoa</th>
            <th scope="col">Etapa</th>
            {catalog.areas.map((a) => <th key={a.code} scope="col" title={a.name}><abbr title={a.name}>{a.code}</abbr></th>)}
          </tr>
        </thead>
        {teamGroups.map((g) => (
          <tbody key={g.team}>
            {teamGroups.length > 1 && (
              <tr className="team-row"><th scope="rowgroup" colSpan={2 + catalog.areas.length}>{g.team} <span className="faint">· {g.rows.length}</span></th></tr>
            )}
          {g.rows.map(({ p, cells }) => (
            <tr key={p.membership_id}>
              <th scope="row">
                <button type="button" className="link-btn" onClick={() => onPick(p.membership_id)}>{p.full_name}{p.is_me ? ' (tu)' : ''}</button>
                <span className="faint team-sub">{teamName(p.team_id)}</span>
              </th>
              <td className="nowrap">{milestoneByKey[p.milestone as MilestoneKey]?.short ?? '—'}</td>
              {catalog.areas.map((a) => {
                const c = cells[a.code];
                if (!c) return <td key={a.code} className="cell-empty"><span className="sr-only">Sem etapa</span>·</td>;
                const Icon = ICON[c.status];
                return (
                  <td key={a.code} className={`cell fs-${c.status}`} title={`${a.name}: ${c.trail?.name ?? ''} ${STATUS_TEXT[c.status]}`.trim()}>
                    <Icon size={15} aria-hidden="true" />
                    <span className="sr-only">{a.name}: {c.trail ? `${c.trail.name}, ` : ''}{STATUS_TEXT[c.status]}</span>
                  </td>
                );
              })}
            </tr>
          ))}
          </tbody>
        ))}
      </table>
      <ul className="team-legend" aria-label="Legenda">
        {(Object.keys(STATUS_TEXT) as ChecklistStatus[]).map((k) => {
          const Icon = ICON[k];
          return <li key={k} className={`fs-${k}`}><Icon size={14} aria-hidden="true" /> {STATUS_TEXT[k]}</li>;
        })}
      </ul>
    </div>
  );
}
