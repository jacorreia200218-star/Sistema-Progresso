import { createContext, useContext, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown, Circle, Clock, Compass, Eye, EyeOff, FlaskConical, Info, MessageCircle, MoreHorizontal,
  Pencil, RotateCcw, SlidersHorizontal, Send, Sprout, X,
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

/** Etiqueta discreta ao lado do título (ex.: «Em teste» nos módulos em teste). */
export const PageTagContext = createContext<ReactNode>(null);

export function TestTag() {
  return (
    <span className="page-tag" title="Ambiente de teste: os dados deste espaço não entram nos registos reais.">
      <FlaskConical size={13} aria-hidden="true" />
      Em teste<span className="sr-only">: os dados deste espaço não entram nos registos reais</span>
    </span>
  );
}

/**
 * Cabeçalho da página: título, ação principal à direita e, se for preciso explicar alguma
 * coisa, «Mais informação» recolhido. Evita parágrafos que só repetem o título.
 */
export function PageTitle({ title, subtitle, back, actions, info }: {
  title: string; subtitle?: ReactNode; back?: string | true; actions?: ReactNode; info?: ReactNode;
}) {
  const tag = useContext(PageTagContext);
  useEffect(() => {
    document.title = `${title} · Pioneiros`;
  }, [title]);
  return (
    <header className="page-head">
      {back && <Back to={back === true ? undefined : back} />}
      <div className="page-head-row">
        <h1>{title}{tag && <> {tag}</>}</h1>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
      {subtitle && <p className="lead">{subtitle}</p>}
      {info && <MoreInfo>{info}</MoreInfo>}
    </header>
  );
}

/** Explicação adicional, recolhida por omissão. */
export function MoreInfo({ children, label = 'Mais informação' }: { children: ReactNode; label?: string }) {
  return (
    <details className="more-info">
      <summary><Info size={15} aria-hidden="true" /> {label}</summary>
      <div className="more-info-body prose">{children}</div>
    </details>
  );
}

/** Campos opcionais de um formulário, recolhidos por omissão (abre sozinho quando já há algo preenchido). */
export function MoreOptions({ children, open, label = 'Mais opções' }: { children: ReactNode; open?: boolean; label?: string }) {
  return (
    <details className="more-options" open={open}>
      <summary><ChevronDown size={16} aria-hidden="true" className="more-chevron" /> {label}</summary>
      <div className="more-options-body">{children}</div>
    </details>
  );
}

/** Menu «Mais» para ações secundárias. Fecha ao escolher, ao clicar fora e com Escape. */
export function MoreMenu({ children, label = 'Mais', className = '' }: { children: ReactNode; label?: string; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) {
        el.open = false;
        if (e instanceof KeyboardEvent) el.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
  }, []);
  return (
    <details className={`menu more-menu ${className}`} ref={ref}>
      <summary className="btn secondary" role="button" aria-label={label === 'Mais' ? 'Mais ações' : undefined}>
        {label === 'Mais' ? <MoreHorizontal size={18} aria-hidden="true" /> : null}
        {label}
        <ChevronDown size={16} aria-hidden="true" className="more-chevron" />
      </summary>
      <div className="menu-panel more-panel" onClick={(e) => {
        // Uma ação escolhida fecha o menu (os formulários abertos a partir dele ficam fora do menu).
        if ((e.target as HTMLElement).closest('a, button')) ref.current!.open = false;
      }}>
        {children}
      </div>
    </details>
  );
}

/**
 * Filtros: no computador ficam à vista; no telemóvel ficam atrás do botão «Filtros»
 * (com o número de filtros ativos), para a página começar pelo conteúdo.
 */
export function Filters({ active = 0, children, search, extra }: { active?: number; children: ReactNode; search?: ReactNode; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`filters${open ? ' is-open' : ''}`}>
      <div className="filters-top">
        {search}
        <button type="button" className={`btn secondary filters-toggle${active ? ' has-active' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <SlidersHorizontal size={16} aria-hidden="true" /> Filtros{active > 0 && <span className="count">{active}</span>}
        </button>
        {extra}
      </div>
      <div className="filters-body">{children}</div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {hint && (
        <span className="hint prose" id={`${htmlFor}-hint`}>
          {hint}
        </span>
      )}
      {children}
    </div>
  );
}

/** Campo de palavra-passe com botão para mostrar/ocultar o que se escreveu. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="password-field">
      <input {...props} type={show ? 'text' : 'password'} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="password-toggle" aria-pressed={show} aria-controls={props.id}
        aria-label={show ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'} onClick={() => setShow((v) => !v)}>
        {show ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
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

// URLs assinados das fotografias, reaproveitados entre páginas (evita piscar e pedidos repetidos).
const photoUrls = new Map<string, { url: string; until: number }>();
function cachedPhoto(path?: string | null) {
  const hit = path ? photoUrls.get(path) : undefined;
  return hit && hit.until > Date.now() ? hit.url : null;
}

/** Avatar com iniciais; a fotografia carrega por cima, sem bloquear o resto. */
export function Avatar({ name, photoPath, size }: { name: string; photoPath?: string | null; size?: 'lg' }) {
  const [url, setUrl] = useState<string | null>(() => cachedPhoto(photoPath));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    const hit = cachedPhoto(photoPath);
    setUrl(hit);
    if (photoPath && !hit) {
      signedUrl('fotografias', photoPath, 3600)
        .then((u) => {
          if (!u) return;
          photoUrls.set(photoPath, { url: u, until: Date.now() + 50 * 60 * 1000 });
          if (alive) setUrl(u);
        })
        .catch(() => undefined);
    }
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
      <span className="avatar-initials">{initials || '?'}</span>
      {url && !failed && <img src={url} alt="" decoding="async" onError={() => setFailed(true)} />}
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
