// Mapa do caminho: um trilho desenhado, com os marcos do manual ao longo dele e
// as pessoas junto do marco onde estão. Os marcos ficam numa grelha normal (a altura
// adapta-se ao conteúdo e os grupos nunca se sobrepõem) e o trilho é desenhado a
// partir das posições reais dos marcos. A posição resulta do progresso validado:
// não há arrastar nem ordenação por progresso.
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MILESTONES, type MilestoneKey } from '../../lib/caminho';
import type { PathMember } from '../../lib/api';
import { Avatar } from '../ui';
import { Doodle, type DoodleSpot, MapDoodles } from './Doodles';

export type StepStatus = 'feito' | 'atual' | 'por_vir' | 'info' | 'neutro' | 'ocupado';

export interface TrackStep {
  status: StepStatus;
  caption?: string;
  content?: ReactNode;
}

type Pt = [number, number];

// Só os marcos vividos na secção (Sinais de Pista e Passagem ficam fora do mapa:
// acontecem antes de entrar ou ao sair, e não são registados na aplicação).
const MAP = MILESTONES.filter((m) => m.tracked);

/** Curva suave que passa pelos pontos (Catmull-Rom → Bézier cúbicas). */
function smooth(pts: Pt[], segments = pts.length - 1): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < Math.min(segments, pts.length - 1); i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

interface Geometry { w: number; h: number; pts: Pt[]; all: Pt[]; turnAt: number | null; wide: boolean }

/** Mede o centro de cada marco e devolve o trajeto (com entrada, curva de volta e saída). */
function useGeometry(ref: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [g, setG] = useState<Geometry | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const dots = [...el.querySelectorAll<HTMLElement>('.track-dot')];
      if (!dots.length || !box.width) return;
      const pts: Pt[] = dots.map((d) => {
        const r = d.getBoundingClientRect();
        return [r.left + r.width / 2 - box.left, r.top + r.height / 2 - box.top];
      });
      // Duas filas quando os três primeiros marcos estão lado a lado (computador).
      const wide = pts.length > 3 && Math.abs(pts[1][1] - pts[0][1]) < 40 && pts[1][0] - pts[0][0] > 100;
      let all: Pt[];
      let turnAt: number | null = null;
      if (wide) {
        // Duas filas: ida da esquerda para a direita, curva à direita e volta.
        const right = Math.min(box.width - 14, pts[2][0] + 70);
        const turn: Pt = [right, (pts[2][1] + pts[3][1]) / 2];
        all = [[0, pts[0][1] + 4], ...pts.slice(0, 3), turn, ...pts.slice(3), [0, pts[pts.length - 1][1] + 4]];
        turnAt = 3;
      } else {
        all = [[pts[0][0] + 6, 0], ...pts, [pts[pts.length - 1][0] - 6, box.height]];
      }
      setG({ w: box.width, h: box.height, pts, all, turnAt, wide });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return g;
}

/** Desenhos colocados nos espaços livres, a partir das posições medidas. */
function doodleSpots(g: Geometry): DoodleSpot[] {
  const px = (x: number, y: number): [string, string] => [`${Math.round(x)}px`, `${Math.round(y)}px`];
  const bottom = g.h - 46;
  if (g.wide) {
    const midY = (g.pts[0][1] + g.pts[3][1]) / 2;
    const gapX1 = (g.pts[0][0] + g.pts[1][0]) / 2;
    const gapX2 = (g.pts[1][0] + g.pts[2][0]) / 2;
    return [
      { kind: 'cloud', at: px(gapX1 - 30, 0), delay: 100 },
      { kind: 'birds', at: px(g.pts[1][0] + 40, 2), delay: 250 },
      { kind: 'cloud', at: px(gapX2 + 20, 0), scale: 0.8, delay: 400 },
      { kind: 'pine', at: px(gapX1 - 12, midY + 10), scale: 0.8, delay: 300 },
      { kind: 'tree', at: px(gapX2 - 14, midY + 12), scale: 0.75, delay: 450 },
      { kind: 'pine', at: px(16, bottom), delay: 500 },
      { kind: 'tree', at: px(48, bottom + 2), scale: 0.9, delay: 600 },
      { kind: 'fire', at: px(g.w * 0.62, bottom + 4), delay: 800 },
      { kind: 'tent', at: px(g.w * 0.62 + 40, bottom), delay: 900 },
      { kind: 'pine', at: px(g.w - 70, bottom + 2), scale: 0.9, delay: 1000 },
      { kind: 'pine', at: px(g.w - 42, bottom), delay: 1100 },
    ];
  }
  const trees: DoodleSpot[] = g.pts
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i % 2 === 1)
    .map(({ p, i }) => ({ kind: i % 4 === 1 ? 'pine' : 'tree', at: px(2, p[1] - 14), scale: 0.65, delay: 200 + i * 120 }) as DoodleSpot);
  return [
    { kind: 'cloud', at: px(g.w - 120, 0), scale: 0.7, delay: 100 },
    { kind: 'birds', at: px(g.w - 56, 6), scale: 0.8, delay: 250 },
    ...trees,
    { kind: 'pine', at: px(g.w * 0.45, bottom), scale: 0.9, delay: 700 },
    { kind: 'fire', at: px(g.w * 0.45 + 34, bottom + 6), scale: 0.9, delay: 850 },
    { kind: 'tent', at: px(g.w * 0.45 + 66, bottom), delay: 1000 },
  ];
}

export function Track({ steps, label }: { steps: Record<MilestoneKey, TrackStep>; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const keys = MAP.map((m) => m.key);
  const current = keys.findIndex((k) => steps[k].status === 'atual');
  const hasDone = keys.some((k) => steps[k].status === 'feito');
  const signature = keys.map((k) => `${steps[k].status}:${steps[k].caption ?? ''}`).join('|');
  const g = useGeometry(ref, [signature]);
  // Parte já percorrida (só no percurso pessoal): os mesmos segmentos da curva completa.
  const walked = hasDone && current > 0 && g;
  const doneSegments = walked ? current + 1 + (g!.turnAt != null && current >= g!.turnAt ? 1 : 0) : 0;
  return (
    <div className={`trail-map ${g ? 'ready' : ''}`} ref={ref}>
      {g && (
        <svg className="map-svg" viewBox={`0 0 ${g.w} ${g.h}`} aria-hidden="true" focusable="false">
          <path d={smooth(g.all)} className="map-path-bg" />
          <path d={smooth(g.all)} className="map-path" />
          {walked && <path d={smooth(g.all, doneSegments)} className="map-path-done" />}
        </svg>
      )}
      {g && <MapDoodles spots={doodleSpots(g)} />}
      <ol className="track" aria-label={label}>
        {MAP.map((m, i) => {
          const s = steps[m.key];
          return (
            <li key={m.key} className={`track-step st-${s.status}`} style={{ '--i': i } as CSSProperties} aria-current={s.status === 'atual' ? 'step' : undefined}>
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

/** Nome curto que distingue pessoas: primeiro nome; se repetir, junta a inicial do apelido. */
export function shortNames(people: { membership_id: string; full_name: string }[]): Map<string, string> {
  const parts = people.map((p) => ({ id: p.membership_id, w: p.full_name.trim().split(/\s+/) }));
  const out = new Map<string, string>();
  const first = (w: string[]) => w[0] ?? '';
  const count = (f: (w: string[]) => string) => parts.reduce<Record<string, number>>((acc, x) => ({ ...acc, [f(x.w)]: (acc[f(x.w)] ?? 0) + 1 }), {});
  const firsts = count(first);
  const withInitial = (w: string[]) => (w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : w[0]);
  const initials = count(withInitial);
  for (const x of parts) {
    if (firsts[first(x.w)] === 1) out.set(x.id, first(x.w));
    else if (initials[withInitial(x.w)] === 1) out.set(x.id, withInitial(x.w));
    else out.set(x.id, x.w.length > 1 ? `${x.w[0]} ${x.w[x.w.length - 1]}` : x.w[0]);
  }
  return out;
}

/** Avatares de um marco (todos iguais), com «+N» para a lista completa. */
export function PeopleRow({ people, max, hidden, onPick, onMore, teamName, names }: {
  people: PathMember[];
  names: Map<string, string>;
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
          {/* Nome curto por baixo (desambiguado); o nome completo no rato (title), no teclado e
              nos leitores de ecrã (aria-label) e, ao tocar, na ficha da pessoa. */}
          <button type="button" className="avatar-btn" onClick={() => onPick(p.membership_id)}
            title={`${p.full_name} · ${teamName(p.team_id)}`}
            aria-label={`${p.full_name}${p.is_me ? ' (tu)' : ''}, ${teamName(p.team_id)}`}>
            <Avatar name={p.full_name} photoPath={p.photo_path} />
            <span className="avatar-name" aria-hidden="true">{p.is_me ? 'Tu' : names.get(p.membership_id) ?? p.full_name}</span>
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
