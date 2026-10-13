// Desenhos do mapa, em traço de lápis: pinheiros, árvores, nuvens, pássaros e um
// acampamento. São só decoração (aria-hidden, sem cliques) e ficam nos espaços
// livres, sem tapar marcos nem pessoas. Desenham-se ao abrir e depois mexem-se
// devagar; com «movimento reduzido» ficam parados.
import type { CSSProperties, ReactNode } from 'react';

type Kind = 'pine' | 'tree' | 'cloud' | 'birds' | 'tent' | 'fire' | 'flag' | 'grass';

const SIZE: Record<Kind, [number, number]> = {
  pine: [28, 40], tree: [32, 38], cloud: [62, 26], birds: [44, 20], tent: [58, 40], fire: [30, 34], flag: [26, 34], grass: [30, 12],
};

function Shape({ kind }: { kind: Kind }): ReactNode {
  const p = { pathLength: 1, vectorEffect: 'non-scaling-stroke' as const };
  switch (kind) {
    case 'pine':
      return (
        <g className="sway">
          <path {...p} className="ink-green" d="M14 3 L6 15 H10 L4 25 H9 L2 34 H26 L19 25 H24 L18 15 H22 Z" />
          <path {...p} className="ink-soft" d="M14 34 V39" />
        </g>
      );
    case 'tree':
      return (
        <g className="sway">
          <path {...p} className="ink-green fill-green" d="M16 4 C8 4 4 10 6 15 C2 18 4 26 11 26 C13 29 20 29 22 26 C29 26 31 18 27 15 C29 9 24 4 16 4 Z" />
          <path {...p} className="ink-soft" d="M16 26 V37 M16 31 L12 27 M16 30 L20 26" />
        </g>
      );
    case 'cloud':
      return (
        <g className="drift">
          <path {...p} className="ink-faint fill-card" d="M10 22 C3 22 2 14 9 13 C9 6 18 4 22 9 C25 3 36 3 38 10 C44 6 53 9 52 15 C59 15 60 22 53 22 Z" />
        </g>
      );
    case 'birds':
      return (
        <g className="flap">
          <path {...p} className="ink-soft" d="M2 10 Q7 4 11 9 Q15 4 20 10" />
          <path {...p} className="ink-soft" d="M24 15 Q28 10 31 14 Q34 10 38 15" />
        </g>
      );
    case 'tent':
      return (
        <g>
          <path {...p} className="ink-accent fill-tint" d="M4 37 L29 5 L54 37 Z" />
          <path {...p} className="ink-accent" d="M29 5 L29 37 M22 37 L29 22 L36 37 M26 5 L29 1 L32 5" />
          <path {...p} className="ink-soft" d="M1 38 H57" />
        </g>
      );
    case 'fire':
      return (
        <g>
          <g className="flicker">
            <path {...p} className="ink-amber fill-amber" d="M15 4 C19 11 24 14 22 21 C21 26 9 26 8 21 C7 16 12 14 11 9 C13 11 14 12 15 4 Z" />
            <path {...p} className="ink-amber" d="M15 14 C17 17 18 19 17 22 C16 24 13 24 13 22 C12 20 14 18 15 14 Z" />
          </g>
          <path {...p} className="ink-soft" d="M4 31 L26 25 M4 25 L26 31" />
        </g>
      );
    case 'flag':
      return (
        <g>
          <path {...p} className="ink-soft" d="M5 33 V3" />
          <path {...p} className="ink-accent fill-tint wave" d="M5 4 C11 1 15 7 22 4 V16 C15 19 11 13 5 16 Z" />
        </g>
      );
    case 'grass':
      return <path {...p} className="ink-green" d="M2 11 Q4 4 6 11 M8 11 Q11 2 13 11 M16 11 Q18 5 20 11 M22 11 Q25 3 27 11" />;
  }
}

export interface DoodleSpot {
  kind: Kind;
  /** Posição: no computador em % (x, y); no telemóvel x em % e y em px. */
  at?: [string, string];
  scale?: number;
  delay?: number;
}

export function Doodle({ kind, at, scale = 1, delay = 0, className = '' }: DoodleSpot & { className?: string }) {
  const [w, h] = SIZE[kind];
  const style = { ...(at ? { left: at[0], top: at[1] } : {}), width: w * scale, height: h * scale, '--d': `${delay}ms` } as CSSProperties;
  return (
    <svg className={`doodle ${className}`} style={style} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <Shape kind={kind} />
    </svg>
  );
}

// Computador: nuvens e pássaros em cima, árvores nos intervalos entre colunas,
// e um pequeno acampamento em baixo.
const WIDE_SPOTS: DoodleSpot[] = [
  { kind: 'cloud', at: ['22%', '1%'], delay: 100 },
  { kind: 'birds', at: ['47%', '2%'], delay: 250 },
  { kind: 'cloud', at: ['70%', '0.5%'], scale: 0.8, delay: 400 },
  { kind: 'pine', at: ['24.5%', '47%'], scale: 0.8, delay: 300 },
  { kind: 'tree', at: ['48.6%', '46%'], scale: 0.8, delay: 450 },
  { kind: 'pine', at: ['72.6%', '47%'], scale: 0.85, delay: 600 },
  { kind: 'pine', at: ['4%', '89%'], delay: 500 },
  { kind: 'tree', at: ['9%', '88%'], scale: 0.9, delay: 600 },
  { kind: 'grass', at: ['30%', '95%'], delay: 700 },
  { kind: 'fire', at: ['60%', '89%'], delay: 800 },
  { kind: 'tent', at: ['65%', '87.5%'], delay: 900 },
  { kind: 'pine', at: ['88%', '88%'], scale: 0.9, delay: 1000 },
  { kind: 'pine', at: ['92%', '87%'], delay: 1100 },
];

// Telemóvel: pinheiros à esquerda do trilho quando ele faz curva para a direita,
// nuvens em cima e o acampamento no fim.
export function narrowSpots(step: number, top: number, height: number): DoodleSpot[] {
  const trees: DoodleSpot[] = [1, 3, 5].map((i, n) => ({ kind: n % 2 ? 'tree' : 'pine', at: ['1%', `${top + i * step - 12}px`], scale: 0.7, delay: 200 + n * 150 }));
  return [
    { kind: 'cloud', at: ['58%', '2px'], scale: 0.7, delay: 100 },
    { kind: 'birds', at: ['80%', '10px'], scale: 0.8, delay: 250 },
    ...trees,
    { kind: 'pine', at: ['46%', `${height - 52}px`], scale: 0.9, delay: 700 },
    { kind: 'fire', at: ['60%', `${height - 42}px`], scale: 0.9, delay: 850 },
    { kind: 'tent', at: ['70%', `${height - 50}px`], delay: 1000 },
  ];
}

export function MapDoodles({ narrow }: { narrow: DoodleSpot[] }) {
  return (
    <div className="doodles" aria-hidden="true">
      {WIDE_SPOTS.map((s, i) => <Doodle key={`w${i}`} {...s} className="only-wide" />)}
      {narrow.map((s, i) => <Doodle key={`n${i}`} {...s} className="only-narrow" />)}
    </div>
  );
}
