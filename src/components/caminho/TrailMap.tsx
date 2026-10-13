// Mapa do caminho em SVG: um trilho curvo com os marcos do manual (pp. 3 e 14),
// sinais de pista desenhados com traços simples (não são insígnias oficiais) e
// as pessoas agrupadas no marco onde estão — nunca numa distância contínua.
import type { KeyboardEvent, ReactNode } from 'react';
import { Flag, Tent } from 'lucide-react';
import { MILESTONES, type MilestoneKey, type Phase } from '../../lib/caminho';

export type NodeStatus = 'feito' | 'atual' | 'por_vir' | 'info' | 'neutro';

export interface MapPerson {
  id: string;
  name: string;
}

export interface MapNode {
  status: NodeStatus;
  count?: number;
  people?: MapPerson[];
  caption?: string;
  phases?: Phase[]; // ciclo da etapa (só nas etapas de progresso)
}

interface Props {
  nodes: Record<MilestoneKey, MapNode>;
  selected: MilestoneKey | null;
  onSelect: (k: MilestoneKey) => void;
  title: string;
}

type Pt = [number, number];

// Curva suave (Catmull-Rom convertida em Bézier cúbicas) que passa pelos marcos.
function smoothPath(pts: Pt[]): string {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const LAYOUTS = {
  largo: {
    w: 1000, h: 600, r: 32,
    pts: [[95, 120], [330, 165], [565, 105], [835, 160], [865, 400], [615, 445], [365, 390], [120, 440]] as Pt[],
    tailStart: [-30, 95] as Pt, tailEnd: [-30, 470] as Pt,
    label: (_i: number) => ({ dx: 0, dy: 62, anchor: 'middle' as const }),
  },
  estreito: {
    w: 360, h: 1300, r: 27,
    pts: Array.from({ length: 8 }, (_, i) => [i % 2 === 0 ? 78 : 282, 90 + i * 155]) as Pt[],
    tailStart: [78, -10] as Pt, tailEnd: [282, 1330] as Pt,
    label: (i: number) => (i % 2 === 0 ? { dx: 42, dy: -6, anchor: 'start' as const } : { dx: -42, dy: -6, anchor: 'end' as const }),
  },
};

// Linhas topográficas discretas (decorativas).
function Topo({ w, h }: { w: number; h: number }) {
  const lines: string[] = [];
  for (let k = 0; k < 9; k++) {
    const cx = (k % 3) * (w / 2.4) + w * 0.12;
    const cy = Math.floor(k / 3) * (h / 2.6) + h * 0.15;
    for (let j = 1; j <= 3; j++) {
      const rx = 40 + j * 26 + (k % 2) * 10;
      const ry = 22 + j * 15;
      lines.push(
        `M${cx - rx},${cy} C${cx - rx},${cy - ry * 1.2} ${cx + rx * 0.6},${cy - ry} ${cx + rx},${cy - ry * 0.2} ` +
          `C${cx + rx * 1.1},${cy + ry * 0.7} ${cx - rx * 0.3},${cy + ry * 1.1} ${cx - rx},${cy} Z`,
      );
    }
  }
  return <path d={lines.join(' ')} fill="none" stroke="var(--topo)" strokeWidth="1.2" aria-hidden="true" />;
}

// Sinais de pista (traços simples inspirados nos sinais desenhados no manual).
function SignArrow({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" aria-hidden="true">
      <path d="M-14 0 H12 M4 -7 L12 0 L4 7" />
      <path d="M-10 -5 L-6 0 L-10 5" opacity="0.6" />
    </g>
  );
}
function SignStones({ x, y, inner }: { x: number; y: number; inner?: boolean }) {
  const dots = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return <circle key={i} cx={x + Math.cos(a) * 12} cy={y + Math.sin(a) * 12} r="2.4" fill="currentColor" />;
  });
  return (
    <g aria-hidden="true">
      {dots}
      {inner && <circle cx={x} cy={y} r="3.2" fill="currentColor" />}
    </g>
  );
}
function SignChevrons({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" aria-hidden="true">
      <path d="M-14 -7 L-7 0 L-14 7 M-4 -7 L3 0 L-4 7 M6 -7 L13 0 L6 7" />
    </g>
  );
}
function SignAvoid({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke="var(--ink-faint)" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <path d="M-9 -9 L9 9 M9 -9 L-9 9" />
    </g>
  );
}

function NodeIcon({ k, x, y, stage }: { k: MilestoneKey; x: number; y: number; stage?: number }) {
  switch (k) {
    case 'sinais_pista':
      return <SignChevrons x={x} y={y} />;
    case 'inicio_pista':
      return <SignStones x={x} y={y} />;
    case 'promessa':
      return <Flag x={x - 11} y={y - 11} width={22} height={22} strokeWidth={2.2} aria-hidden="true" />;
    case 'acampamento':
      return <Tent x={x - 12} y={y - 12} width={24} height={24} strokeWidth={2.1} aria-hidden="true" />;
    case 'passagem':
      return <SignStones x={x} y={y} inner />;
    default:
      return (
        <g>
          <SignArrow x={x} y={y - 4} s={0.9} />
          <text x={x} y={y + 16} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">{['I', 'II', 'III'][(stage ?? 1) - 1]}</text>
        </g>
      );
  }
}

// Anel do ciclo de cada etapa (p. 14): quatro arcos = escolha, oportunidades, validação, reconhecimento.
function CycleRing({ x, y, r, phases }: { x: number; y: number; r: number; phases?: Phase[] }) {
  const R = r + 9;
  const arcs = [0, 1, 2, 3].map((i) => {
    const a0 = -Math.PI / 2 + i * (Math.PI / 2) + 0.16;
    const a1 = -Math.PI / 2 + (i + 1) * (Math.PI / 2) - 0.16;
    const d = `M${x + R * Math.cos(a0)},${y + R * Math.sin(a0)} A${R},${R} 0 0 1 ${x + R * Math.cos(a1)},${y + R * Math.sin(a1)}`;
    const st = phases?.[i]?.status;
    const stroke = st === 'feito' ? 'var(--green-ink)' : st === 'atual' ? 'var(--red-ink)' : 'var(--path-edge)';
    return <path key={i} d={d} stroke={stroke} strokeWidth={st === 'atual' ? 5 : 4} fill="none" strokeLinecap="round" opacity={st ? 1 : 0.55} />;
  });
  return <g aria-hidden="true">{arcs}</g>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
}

function PeopleStack({ x, y, people, count, align }: { x: number; y: number; people: MapPerson[]; count: number; align: 'start' | 'middle' | 'end' }) {
  if (!count) return null;
  const shown = people.slice(0, 3);
  const extra = count - shown.length;
  const step = 20;
  const width = shown.length * step + (extra > 0 ? 30 : 0);
  const x0 = align === 'middle' ? x - width / 2 : align === 'end' ? x - width : x;
  return (
    <g aria-hidden="true">
      {shown.map((p, i) => (
        <g key={p.id}>
          <circle cx={x0 + 11 + i * step} cy={y} r="11" fill="var(--green-tint)" stroke="var(--card)" strokeWidth="2" />
          <text x={x0 + 11 + i * step} y={y + 4} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--green-ink)">{initials(p.name)}</text>
        </g>
      ))}
      {extra > 0 && (
        <g>
          <rect x={x0 + shown.length * step + 2} y={y - 10} width="28" height="20" rx="10" fill="var(--surface-3)" />
          <text x={x0 + shown.length * step + 16} y={y + 4} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--ink)">+{extra}</text>
        </g>
      )}
    </g>
  );
}

function MapSvg({ variant, nodes, selected, onSelect, title }: Props & { variant: keyof typeof LAYOUTS }) {
  const L = LAYOUTS[variant];
  const d = smoothPath([L.tailStart, ...L.pts, L.tailEnd]);
  const idp = `mapa-${variant}`;
  const onKey = (k: MilestoneKey) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(k);
    }
  };
  return (
    <svg viewBox={`0 0 ${L.w} ${L.h}`} className={`trail-map trail-map-${variant}`} role="group" aria-labelledby={`${idp}-t`}>
      <title id={`${idp}-t`}>{title}</title>
      <Topo w={L.w} h={L.h} />
      {/* trilho */}
      <path d={d} fill="none" stroke="var(--path-edge)" strokeWidth={variant === 'largo' ? 30 : 26} strokeLinecap="round" opacity="0.45" />
      <path d={d} fill="none" stroke="var(--path)" strokeWidth={variant === 'largo' ? 24 : 20} strokeLinecap="round" />
      <path d={d} fill="none" stroke="var(--path-edge)" strokeWidth="1.5" strokeDasharray="2 10" strokeLinecap="round" />
      {/* sinais ao longo do trilho */}
      <g color="var(--path-edge)">
        {L.pts.slice(0, -1).map((p, i) => {
          const q = L.pts[i + 1];
          return <SignArrow key={i} x={(p[0] + q[0]) / 2} y={(p[1] + q[1]) / 2 + (variant === 'largo' ? 0 : 0)} s={0.7} />;
        })}
      </g>
      {/* caminho a evitar (p. 9): um desvio sem saída */}
      {variant === 'largo' ? (
        <g>
          <path d="M700,128 C730,60 780,50 820,40" fill="none" stroke="var(--path)" strokeWidth="10" strokeLinecap="round" opacity="0.7" />
          <SignAvoid x={760} y={64} />
          <text x={790} y={30} fontSize="12" fill="var(--ink-faint)">caminho a evitar</text>
        </g>
      ) : (
        <g>
          <path d="M180,320 C150,300 120,300 90,305" fill="none" stroke="var(--path)" strokeWidth="9" strokeLinecap="round" opacity="0.7" />
          <SignAvoid x={110} y={302} />
          <text x={36} y={286} fontSize="11.5" fill="var(--ink-faint)">caminho a evitar</text>
        </g>
      )}
      {/* volta ao início de pista, na secção seguinte */}
      {variant === 'largo' ? (
        <g>
          <path d="M70,420 C10,330 10,230 280,150" fill="none" stroke="var(--ink-faint)" strokeWidth="1.6" strokeDasharray="5 6" markerEnd={`url(#${idp}-seta)`} />
          <text x={28} y={300} fontSize="12" fill="var(--ink-faint)" transform="rotate(-62 28 300)">na secção seguinte</text>
        </g>
      ) : null}
      <defs>
        <marker id={`${idp}-seta`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-faint)" />
        </marker>
      </defs>

      {MILESTONES.map((m, i) => {
        const [x, y] = L.pts[i];
        const n = nodes[m.key];
        const isSel = selected === m.key;
        const stageNo = ['conhecimento', 'vontade', 'construcao'].indexOf(m.key) + 1;
        const lab = L.label(i);
        const stroke = n.status === 'atual' ? 'var(--red-ink)' : n.status === 'feito' ? 'var(--green-ink)' : 'var(--path-edge)';
        const fill = n.status === 'feito' ? 'var(--green-tint)' : n.status === 'atual' ? 'var(--red-tint)' : 'var(--card)';
        const color = n.status === 'atual' ? 'var(--red-ink)' : n.status === 'feito' ? 'var(--green-ink)' : 'var(--ink-soft)';
        const statusText = { feito: 'concluído', atual: 'estás aqui', por_vir: 'por vir', info: 'momento sem registo na aplicação', neutro: '' }[n.status];
        const aria = [m.name, statusText, n.caption ?? '']
          .filter(Boolean)
          .join('; ');
        const ringGap = stageNo > 0 && lab.anchor !== 'middle' ? 14 : 0;
        const labelX = x + lab.dx + (lab.anchor === 'start' ? ringGap : -ringGap);
        const labelY = y + lab.dy;
        return (
          <g key={m.key} role="button" tabIndex={0} aria-pressed={isSel} aria-label={aria} className="map-node"
            onClick={() => onSelect(m.key)} onKeyDown={onKey(m.key)}>
            {/* área de toque generosa (marco + rótulo) */}
            <rect x={lab.anchor === 'middle' ? x - 70 : lab.anchor === 'start' ? x - L.r - 8 : x - 190} y={y - L.r - 18}
              width={lab.anchor === 'middle' ? 140 : 198 + L.r} height={L.r * 2 + 90} rx="16" fill="transparent" />
            {stageNo > 0 && <CycleRing x={x} y={y} r={L.r} phases={n.phases} />}
            {isSel && <circle cx={x} cy={y} r={L.r + (stageNo > 0 ? 17 : 9)} fill="none" stroke="var(--focus)" strokeWidth="3" />}
            <circle cx={x} cy={y} r={L.r} fill={fill} stroke={stroke} strokeWidth={n.status === 'atual' ? 4 : 2.5}
              strokeDasharray={n.status === 'por_vir' ? '6 5' : n.status === 'info' ? '2 5' : undefined} />
            <g color={color}>
              <NodeIcon k={m.key} x={x} y={y} stage={stageNo} />
            </g>
            {n.count != null && n.count > 0 && (
              <g>
                <circle cx={x + L.r * 0.78} cy={y - L.r * 0.78} r="12" fill="var(--ink)" />
                <text x={x + L.r * 0.78} y={y - L.r * 0.78 + 4} textAnchor="middle" fontSize="11.5" fontWeight="700" fill="var(--ivory)">{n.count}</text>
              </g>
            )}
            <text x={labelX} y={labelY} textAnchor={lab.anchor} fontSize={variant === 'largo' ? 15 : 14.5} fontWeight="700" fill="var(--ink)">{m.short}</text>
            {n.caption && (
              <text x={labelX} y={labelY + 17} textAnchor={lab.anchor} fontSize="12" fill={n.status === 'atual' ? 'var(--red-ink)' : 'var(--ink-soft)'}>{n.caption}</text>
            )}
            {stageNo > 0 && (
              <text x={labelX} y={labelY + (n.caption ? 33 : 17)} textAnchor={lab.anchor} fontSize="11" fill="var(--ink-faint)">
                {stageNo} trilho{stageNo > 1 ? 's' : ''} por área
              </text>
            )}
            {n.people && n.people.length > 0 && (
              <PeopleStack x={labelX} y={labelY + (stageNo > 0 ? (n.caption ? 52 : 36) : n.caption ? 36 : 20)} people={n.people} count={n.people.length} align={lab.anchor} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function TrailMap(props: Props): ReactNode {
  return (
    <div className="trail-map-wrap">
      <MapSvg {...props} variant="largo" />
      <MapSvg {...props} variant="estreito" />
    </div>
  );
}

export function MapLegend() {
  return (
    <ul className="map-legend" aria-label="Legenda do mapa">
      <li><span className="lg lg-feito" aria-hidden="true" /> Concluído</li>
      <li><span className="lg lg-atual" aria-hidden="true" /> Onde está agora</li>
      <li><span className="lg lg-porvir" aria-hidden="true" /> Por vir</li>
      <li><span className="lg lg-info" aria-hidden="true" /> Momento sem registo na aplicação</li>
      <li>
        <svg width="34" height="34" viewBox="-17 -17 34 34" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => {
            const a0 = -Math.PI / 2 + i * (Math.PI / 2) + 0.2;
            const a1 = a0 + Math.PI / 2 - 0.4;
            return <path key={i} d={`M${13 * Math.cos(a0)},${13 * Math.sin(a0)} A13,13 0 0 1 ${13 * Math.cos(a1)},${13 * Math.sin(a1)}`} stroke={i === 0 ? 'var(--green-ink)' : i === 1 ? 'var(--red-ink)' : 'var(--path-edge)'} strokeWidth="3.5" fill="none" strokeLinecap="round" />;
          })}
        </svg>
        Ciclo da etapa: escolha · oportunidades · validação · reconhecimento
      </li>
    </ul>
  );
}
