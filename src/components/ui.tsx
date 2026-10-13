import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, Circle, Clock, Compass, Info, MessageCircle, Pencil, RotateCcw, Send, Sprout, X,
} from 'lucide-react';
import type { Tone } from '../lib/labels';
import { signedUrl } from '../lib/api';

const ICONS: Record<string, typeof Check> = {
  check: CheckCircle2, clock: Clock, return: RotateCcw, pencil: Pencil, compass: Compass, message: MessageCircle,
  circle: Circle, send: Send, x: X,
};

export function Badge({ label, tone, icon }: { label: string; tone: Tone; icon?: string }) {
  const Icon = icon ? ICONS[icon] : null;
  return (
    <span className={`badge tone-${tone}`}>
      {Icon && <Icon size={15} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** Carregamento com esqueletos de altura reservada (evita saltos de layout). */
export function Loading({ label = 'A carregar…', rows = 3, compact }: { label?: string; rows?: number; compact?: boolean }) {
  if (compact)
    return (
      <div className="loading" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        {label}
      </div>
    );
  return (
    <div className="skeleton-stack" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 76 : 132 }} aria-hidden="true" />
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="alert error" role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <div>
        <p>{msg}</p>
        {retry && (
          <button type="button" className="btn secondary" onClick={retry}>
            Tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'success' | 'warn' | 'error'; children: ReactNode }) {
  const Icon = kind === 'success' ? Check : kind === 'info' ? Info : AlertCircle;
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={20} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Sprout size={28} aria-hidden="true" />
      <p style={{ fontWeight: 600, color: 'var(--ink)' }}>{title}</p>
      {children}
    </div>
  );
}

export function Back({ to, label = 'Voltar' }: { to?: string; label?: string }) {
  const navigate = useNavigate();
  // Volta à página anterior (mantendo filtros e separadores); se a página foi
  // aberta diretamente (sem histórico na aplicação), vai para o destino indicado.
  const canGoBack = typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0;
  return (
    <button type="button" className="back btn ghost" style={{ color: 'var(--ink-soft)', paddingLeft: 0 }}
      onClick={() => (canGoBack ? navigate(-1) : navigate(to ?? '/'))}>
      <ArrowLeft size={18} aria-hidden="true" /> {label}
    </button>
  );
}

export function PageTitle({ title, subtitle, back }: { title: string; subtitle?: ReactNode; back?: string | true }) {
  useEffect(() => {
    document.title = `${title} · Pioneiros`;
  }, [title]);
  return (
    <header style={{ marginBottom: 16 }}>
      {back && <Back to={back === true ? undefined : back} />}
      <h1>{title}</h1>
      {subtitle && <p className="lead">{subtitle}</p>}
    </header>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {hint && (
        <span className="hint" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="row between faint">
        <span>{label}</span>
        <span>
          {value} de {max}
        </span>
      </div>
      <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Avatar com iniciais; a fotografia carrega por cima, sem bloquear o resto. */
export function Avatar({ name, photoPath, size }: { name: string; photoPath?: string | null; size?: 'lg' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setLoaded(false);
    if (photoPath) signedUrl('fotografias', photoPath, 3600).then((u) => alive && setUrl(u)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [photoPath]);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span className={`avatar ${size ?? ''}`} aria-hidden="true">
      {url ? (
        <img src={url} alt="" onLoad={() => setLoaded(true)} style={{ display: loaded ? 'block' : 'none' }} />
      ) : null}
      {!loaded && (initials || '?')}
    </span>
  );
}

/** Confirmação inline (sem janelas modais) para ações importantes. */
export function ConfirmButton({
  children, confirmLabel, onConfirm, disabled, className = 'btn secondary', description,
}: {
  children: ReactNode; confirmLabel: string; onConfirm: () => void; disabled?: boolean; className?: string; description?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  return (
    <div className="card flat" role="group" aria-label="Confirmação" style={{ marginTop: 8 }}>
      {description && <p>{description}</p>}
      <div className="btn-row" style={{ marginTop: 0 }}>
        <button type="button" className="btn" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>
          {confirmLabel}
        </button>
        <button type="button" className="btn secondary" onClick={() => setAsking(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
