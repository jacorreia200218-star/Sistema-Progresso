// Evolução do saldo: gráfico de linha em SVG próprio (sem bibliotecas), desenhado à largura
// real do contentor, com cores do tema (modo escuro) e alternativa acessível em tabela.
import { useEffect, useId, useRef, useState } from 'react';
import { formatDay, formatEuros } from '../common';
import { monthLabel, type EvolutionPoint } from './api';

const DAY = 86400000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pointLabel = (p: EvolutionPoint) => (p.kind === 'mes' ? `fim de ${monthLabel(p.date.slice(0, 7))}` : p.kind === 'inicio' ? `início (${formatDay(p.date)})` : formatDay(p.date));

/** Valor curto para os eixos: «12,5 mil €», «−300 €». */
function axisEuros(cents: number) {
  const e = cents / 100;
  const abs = Math.abs(e);
  const sign = e < 0 ? '−' : '';
  if (abs >= 10000) return `${sign}${(abs / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 0 })} mil €`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} mil €`;
  return `${sign}${abs.toLocaleString('pt-PT', { maximumFractionDigits: 0 })} €`;
}

export function BalanceChart({ points, granularity }: { points: EvolutionPoint[]; granularity: 'mes' | 'dia' | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const id = useId();
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!points.length) return null;
  const height = width < 480 ? 150 : 170;
  const pad = { l: width < 480 ? 54 : 64, r: 12, t: 10, b: 24 };
  const values = points.map((p) => p.saldo);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) { lo -= Math.max(100, Math.abs(lo) * 0.1); hi += Math.max(100, Math.abs(hi) * 0.1); }
  const span = hi - lo;
  lo -= span * 0.08; hi += span * 0.08;
  const t0 = t(points[0].date);
  const t1 = Math.max(t(points[points.length - 1].date), t0 + DAY);
  const x = (d: string) => pad.l + ((t(d) - t0) / (t1 - t0)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.saldo).toFixed(1)}`).join(' ');
  const base = y(Math.max(lo, Math.min(0, hi)));
  const area = `${line} L${x(points[points.length - 1].date).toFixed(1)},${base.toFixed(1)} L${x(points[0].date).toFixed(1)},${base.toFixed(1)} Z`;
  const ticks = [hi - (hi - lo) * 0.08, (hi + lo) / 2, lo + (hi - lo) * 0.08];
  // Etiquetas do eixo horizontal: todas as de fim de mês se couberem; senão, a primeira e a última.
  const monthly = points.filter((p) => p.kind === 'mes');
  const xLabels = granularity === 'mes' && monthly.length * 38 <= width - pad.l - pad.r
    ? monthly.map((p) => ({ d: p.date, text: MONTH_SHORT[Number(p.date.slice(5, 7)) - 1] }))
    : [points[0], points[points.length - 1]].map((p) => ({ d: p.date, text: shortDay(p.date) }));
  const first = points[0];
  const last = points[points.length - 1];
  const min = points.reduce((a, p) => (p.saldo < a.saldo ? p : a), first);
  const max = points.reduce((a, p) => (p.saldo > a.saldo ? p : a), first);

  return (
    <figure className="fin-chart">
      <div ref={wrap} className="fin-chart-box">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-t ${id}-d`}>
          <title id={`${id}-t`}>Evolução do saldo</title>
          <desc id={`${id}-d`}>
            {`De ${formatEuros(first.saldo)} em ${formatDay(first.date)} para ${formatEuros(last.saldo)} em ${formatDay(last.date)}. `}
            {`Mínimo ${formatEuros(min.saldo)} (${formatDay(min.date)}); máximo ${formatEuros(max.saldo)} (${formatDay(max.date)}).`}
          </desc>
          {ticks.map((v, i) => (
            <g key={i}>
              <line className="fin-chart-grid" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
              <text className="fin-chart-label" x={pad.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">{axisEuros(v)}</text>
            </g>
          ))}
          {lo < 0 && hi > 0 && <line className="fin-chart-zero" x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} />}
          <path className="fin-chart-area" d={area} />
          <path className="fin-chart-line" d={line} />
          {points.length <= 40 && points.map((p) => (
            <circle key={`${p.date}-${p.kind}`} className="fin-chart-dot" cx={x(p.date)} cy={y(p.saldo)} r={2.5}>
              <title>{`${pointLabel(p)}: ${formatEuros(p.saldo)}`}</title>
            </circle>
          ))}
          {xLabels.map((l, i) => (
            <text key={`${l.d}-${i}`} className="fin-chart-label" x={x(l.d)} y={height - 6}
              textAnchor={xLabels.length === 2 ? (i === 0 ? 'start' : 'end') : 'middle'}>{l.text}</text>
          ))}
        </svg>
      </div>
      <details className="fin-chart-table">
        <summary>Ver os valores em tabela</summary>
        <div className="fin-table-wrap">
          <table className="fin-table">
            <caption className="sr-only">Saldo em cada data</caption>
            <thead><tr><th scope="col">Data</th><th scope="col">Saldo</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={`${p.date}-${p.kind}`}><th scope="row">{pointLabel(p)}</th><td>{formatEuros(p.saldo)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
