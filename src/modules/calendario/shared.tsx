// Peças partilhadas do Calendário: parâmetros no endereço, etiquetas e listas.
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, CalendarDays, MapPin } from 'lucide-react';
import { Badge } from '../../components/ui';
import { MISSING_LABEL, RESPONSE_LABEL, RESPONSE_TONE, whenLabel, type CalListItem, type Missing, type Response } from './cal';

/** Parâmetro do endereço (sobrevive a «voltar»). Parte sempre do endereço atual. */
export function useParam(key: string, fallback = '') {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = (v: string, extra?: Record<string, string>) => {
    setParams(() => {
      const next = new URLSearchParams(window.location.search);
      if (v && v !== fallback) next.set(key, v);
      else next.delete(key);
      for (const [k, x] of Object.entries(extra ?? {})) {
        if (x) next.set(k, x);
        else next.delete(k);
      }
      return next;
    }, { replace: true });
  };
  return [value, set] as const;
}

export function ResponseBadge({ response }: { response: Response | null }) {
  if (!response) return <Badge label="Sem resposta" tone="neutral" />;
  return <Badge label={RESPONSE_LABEL[response]} tone={RESPONSE_TONE[response]} icon={response === 'vou' ? 'check' : response === 'nao_vou' ? 'x' : 'clock'} />;
}

/** «O que falta», bem visível. */
export function MissingList({ missing, label = 'Falta' }: { missing: Missing[]; label?: string }) {
  if (!missing.length) return null;
  return (
    <p className="cal-missing">
      <strong>{label}:</strong>{' '}
      {missing.map((m) => <span key={m} className="cal-missing-item">{MISSING_LABEL[m]}</span>)}
    </p>
  );
}

export function EventRow({ e }: { e: CalListItem }) {
  const cancelled = e.status === 'cancelado';
  return (
    <li>
      <Link to={`/calendario/evento/${e.id}`} className={`list-item cal-event-row${cancelled ? ' is-cancelled' : ''}`}>
        <span className="cal-event-icon" aria-hidden="true">{cancelled ? <Ban size={18} /> : <CalendarDays size={18} />}</span>
        <span className="grow">
          <span className="cal-event-title">{e.title}</span>
          <span className="cal-event-meta faint">
            {whenLabel(e)}
            {e.location && <> · <MapPin size={13} aria-hidden="true" /> {e.location}</>}
            {e.audience === 'equipa' && e.team_name && <> · {e.team_name}</>}
          </span>
          {!cancelled && e.involved && <MissingList missing={e.my_missing} label="Falta-te" />}
        </span>
        <span className="cal-event-side">
          {cancelled ? <Badge label="Cancelada" tone="muted" /> : e.involved ? <ResponseBadge response={e.my_response} /> : null}
        </span>
      </Link>
    </li>
  );
}
