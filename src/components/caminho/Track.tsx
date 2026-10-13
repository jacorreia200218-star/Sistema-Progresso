// Mapa do caminho: um trilho desenhado, com os marcos do manual ao longo dele e
// as pessoas junto do marco onde estão. Estilo limpo (sem relevo decorativo).
// A posição resulta do progresso validado: não há arrastar nem ordenação por progresso.
// Os marcos são HTML real (botões e ligações), por cima de um SVG só decorativo.
import type { CSSProperties, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MILESTONES, type MilestoneKey } from '../../lib/caminho';
import type { PathMember } from '../../lib/api';
import { Avatar } from '../ui';
import { Doodle, MapDoodles, narrowSpots } from './Doodles';

export type StepStatus = 'feito' | 'atual' | 'por_vir' | 'info' | 'neutro' | 'ocupado';

export interface TrackStep {
  status: StepStatus;
  caption?: string;
  content?: ReactNode;
}

type Pt = [number, number];

// Computador: duas filas (ida e volta), em percentagem da largura/altura do mapa.
const WIDE: Pt[] = [[13, 9], [38, 13], [62, 9], [86, 13], [86, 60], [62, 56], [38, 60], [13, 56]];
const WIDE_TURN: Pt = [97, 35];
// Telemóvel: trilho vertical com curvas suaves; x em %, y em px (STEP px por marco).
const STEP = 150;
const NARROW_X = [10, 22, 10, 22, 10, 22, 10, 22];
const narrow = (i: number): Pt => [NARROW_X[i], 34 + i * STEP];
export const NARROW_HEIGHT = 34 + 7 * STEP + 120;

/** Curva suave que passa pelos pontos (Catmull-Rom → Bézier cúbicas). */
function smooth(pts: Pt[], segments = pts.length - 1): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < Math.min(segments, pts.length - 1); i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function MapPath({ d, viewBox, className, done }: { d: string; viewBox: string; className: string; done?: string }) {
  return (
    <svg className={`map-svg ${className}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d={d} className="map-path-bg" vectorEffect="non-scaling-stroke" />
      <path d={d} className="map-path" vectorEffect="non-scaling-stroke" pathLength={100} />
      {done && <path d={done} className="map-path-done" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function Track({ steps, label }: { steps: Record<MilestoneKey, TrackStep>; label: string }) {
  const keys = MILESTONES.map((m) => m.key);
  const current = keys.findIndex((k) => steps[k].status === 'atual');
  // Parte do trilho já percorrida (só no percurso pessoal, onde há marcos «feitos»).
  const hasDone = keys.some((k) => steps[k].status === 'feito');
  const wide = [...WIDE.slice(0, 4), WIDE_TURN, ...WIDE.slice(4)];
  const narrowPts = keys.map((_, i) => narrow(i));
  const walked = hasDone && current > 0;
  // Os segmentos percorridos são os mesmos da curva completa (mesmos pontos de controlo).
  const widePts: Pt[] = [[0, 11], ...wide, [0, 56]];
  const narrowAll: Pt[] = [[16, 0], ...narrowPts, [16, NARROW_HEIGHT]];
  const wideDone = walked ? smooth(widePts, current + 1 + (current >= 4 ? 1 : 0)) : undefined;
  const narrowDone = walked ? smooth(narrowAll, current + 1) : undefined;
  return (
    <div className="trail-map" style={{ '--nh': `${NARROW_HEIGHT}px` } as CSSProperties}>
      <MapPath className="map-wide" viewBox="0 0 100 100" d={smooth(widePts)} done={wideDone} />
      <MapPath className="map-narrow" viewBox={`0 0 100 ${NARROW_HEIGHT}`} d={smooth(narrowAll)} done={narrowDone} />
      <MapDoodles narrow={narrowSpots(STEP, 34, NARROW_HEIGHT)} />
      <ol className="track" aria-label={label}>
        {MILESTONES.map((m, i) => {
          const s = steps[m.key];
          const [xw, yw] = WIDE[i];
          const [xn, yn] = narrow(i);
          const style = { '--xw': `${xw}%`, '--yw': `${yw}%`, '--xn': `${xn}%`, '--yn': `${yn}px`, '--i': i } as CSSProperties;
          return (
            <li key={m.key} className={`track-step st-${s.status}`} style={style} aria-current={s.status === 'atual' ? 'step' : undefined}>
              <span className="track-dot" aria-hidden="true">{s.status === 'feito' ? <Check size={14} /> : i + 1}</span>
              {s.status === 'atual' && <Doodle kind="flag" className="here-flag" delay={900} />}
              <div className="track-main">
                <div className="track-head">
                  <strong>{m.name}</strong>
                  {s.caption && <span className="track-caption">{s.caption}</span>}
                </div>
                {s.content}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

/** Avatares de um marco (todos iguais), com «+N» para a lista completa. */
export function PeopleRow({ people, max, hidden, onPick, onMore, teamName }: {
  people: PathMember[];
  max: number;
  hidden: number;
  onPick: (id: string) => void;
  onMore: () => void;
  teamName: (id: string | null) => string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  if (!people.length && !hidden) return null;
  return (
    <ul className="people-row">
      {shown.map((p) => (
        <li key={p.membership_id}>
          <button type="button" className="avatar-btn" onClick={() => onPick(p.membership_id)}
            aria-label={`${p.full_name}${p.is_me ? ' (tu)' : ''}, ${teamName(p.team_id)}`}>
            <Avatar name={p.full_name} photoPath={p.photo_path} />
            <span className="avatar-name" aria-hidden="true">{p.is_me ? 'Tu' : firstName(p.full_name)}</span>
          </button>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button type="button" className="avatar-btn" onClick={onMore} aria-label={`Ver todos (${people.length})`}>
            <span className="avatar more" aria-hidden="true">+{rest}</span>
            <span className="avatar-name" aria-hidden="true">Ver todos</span>
          </button>
        </li>
      )}
      {hidden > 0 && (
        <li className="people-hidden">
          {people.length ? `+${hidden} ${hidden === 1 ? 'outro' : 'outros'}` : `${hidden} ${hidden === 1 ? 'pioneiro' : 'pioneiros'}`}
          <span className="sr-only"> (o nome só aparece a quem acompanha o percurso)</span>
        </li>
      )}
    </ul>
  );
}
