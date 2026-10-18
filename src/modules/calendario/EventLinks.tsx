// O evento como ponto de ligação: separadores Detalhes · Presenças · Ata e tarefas ·
// Material · Finanças. Cada registo vive no seu módulo (mesmo id do evento, mesmo espaço)
// e com as suas permissões; aqui só aparece o separador de um módulo quando a pessoa lhe
// tem acesso e há dados ou pode agir.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, FileText, ListChecks, Package, ShoppingCart, Wallet } from 'lucide-react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useActiveSection } from '../../lib/session';
import { Badge, ErrorBox } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { formatDay, formatEuros } from '../common';
import type { CalDetail } from './cal';

type Totals = { receitas: number; despesas: number; resultado: number };
export type EventLinksData = {
  reservas?: { id: string; item_id: string; item: string; unit: string; quantity: number; status: string }[];
  compras?: { id: string; name: string; quantity: number; unit: string; status: string }[];
  inv_can_manage?: boolean;
  financas?: { orcamento: Totals; efetivo: Totals; por_confirmar: Totals; tem_dados?: boolean } | null;
  fin_can_manage?: boolean;
  reunioes?: { id: string; title: string; kind: string; starts_at: string; ata_id: string | null }[];
  ata_writer?: boolean;
  presencas?: { id: string; title: string; status: string; counts: { presente: number; justificada: number; injustificada: number } | null; mine: string | null } | null;
  pres_can_register?: boolean;
  tarefas?: {
    id: string; kind: string; title: string; exec_status: string; due_date: string | null; overdue: boolean;
    responsible_name: string | null; team_name: string | null; ata_id?: string | null;
  }[];
};

export type TabKey = 'detalhes' | 'presencas' | 'ata' | 'material' | 'financas';
export type TabDef = { key: TabKey; label: string; count?: number; countLabel?: string };

const TASK_STATUS: Record<string, string> = { por_fazer: 'Por fazer', em_curso: 'Em curso', concluida: 'Concluída', feita: 'Concluída', cancelada: 'Arquivada' };
const PRES_STATUS: Record<string, string> = { presente: 'Presente', justificada: 'Falta justificada', injustificada: 'Falta injustificada' };

export function useEventLinks(e: CalDetail) {
  const section = useActiveSection().membership.section_id;
  const { space } = useModuleCtx();
  return useQuery({
    queryKey: ['cal-links', section, space, e.id],
    queryFn: () => call<EventLinksData>('cal_event_links', { p_section: section, p_event: e.id }),
    retry: false,
  });
}

const visibleAtas = (l: EventLinksData) => (l.reunioes ?? []).filter((m) => m.ata_id);
const openTasks = (l: EventLinksData) => (l.tarefas ?? []).filter((t) => t.exec_status === 'por_fazer' || t.exec_status === 'em_curso').length;

/** Separadores disponíveis: um módulo só aparece com acesso e com dados ou algo a fazer. */
export function eventTabs(e: CalDetail, l: EventLinksData | undefined): TabDef[] {
  const tabs: TabDef[] = [{ key: 'detalhes', label: 'Detalhes' }];
  if (!l) return tabs;
  const active = e.status === 'ativo';
  if (l.presencas || (l.pres_can_register && active)) tabs.push({ key: 'presencas', label: 'Presenças' });
  if (visibleAtas(l).length || l.tarefas?.length || (l.ata_writer && active)) {
    const n = openTasks(l);
    tabs.push({ key: 'ata', label: 'Ata e tarefas', count: n || undefined, countLabel: n === 1 ? 'tarefa por fazer' : 'tarefas por fazer' });
  }
  const material = (l.reservas?.length ?? 0) + (l.compras?.length ?? 0);
  if (material || (l.inv_can_manage && active)) tabs.push({ key: 'material', label: 'Material', count: material || undefined, countLabel: material === 1 ? 'registo' : 'registos' });
  if (l.financas && ((l.financas.tem_dados ?? true) || l.fin_can_manage)) tabs.push({ key: 'financas', label: 'Finanças' });
  return tabs;
}

/** Separadores com navegação por teclado (setas, Início, Fim). */
export function EventTabs({ tabs, current, onSelect }: { tabs: TabDef[]; current: TabKey; onSelect: (k: TabKey) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // No telemóvel os separadores deslizam: o escolhido fica sempre à vista.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`#ev-tab-${current}`);
    const box = ref.current;
    if (el && box && (el.offsetLeft < box.scrollLeft || el.offsetLeft + el.offsetWidth > box.scrollLeft + box.clientWidth)) {
      box.scrollLeft = el.offsetLeft - 16;
    }
  }, [current]);
  const onKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.key === current);
    const next = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    ev.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onSelect(t.key);
    ref.current?.querySelector<HTMLButtonElement>(`#ev-tab-${t.key}`)?.focus();
  };
  return (
    <div className="tabs ev-tabs" role="tablist" aria-label="Secções da atividade" ref={ref} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" id={`ev-tab-${t.key}`} className="tab" aria-selected={t.key === current}
          aria-controls={`ev-panel-${t.key}`} tabIndex={t.key === current ? 0 : -1} onClick={() => onSelect(t.key)}>
          {t.label}{t.count ? <><span className="fc-n" aria-hidden="true">{t.count}</span><span className="sr-only"> ({t.count} {t.countLabel})</span></> : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ k, children }: { k: TabKey; children: ReactNode }) {
  return <div role="tabpanel" id={`ev-panel-${k}`} aria-labelledby={`ev-tab-${k}`} className="ev-panel">{children}</div>;
}

function Section({ id, title, icon, children, action }: { id: string; title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card ev-link" aria-labelledby={id}>
      <div className="ev-link-head">
        <h2 id={id}>{icon} {title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Presenças
// ---------------------------------------------------------------------------
export function PresencasPanel({ e, l }: { e: CalDetail; l: EventLinksData }) {
  const section = useActiveSection().membership.section_id;
  const navigate = useNavigate();
  const action = useAction();
  const p = l.presencas;
  const canOpen = !!l.pres_can_register && (!!p || e.status === 'ativo');
  // Abre ou cria a sessão ligada ao evento (o servidor garante uma só sessão por evento).
  const open = async () => {
    const r = await action.run(() => call<{ id: string; created: boolean }>('pres_session_for_event', { p_section: section, p_event: e.id }));
    if (r.ok && r.value) navigate(`/presencas/sessoes/${r.value.id}`);
  };
  return (
    <Section id="ev-pres-h" title="Presenças" icon={<ClipboardCheck size={18} aria-hidden="true" />}>
      {p ? (
        <>
          {p.status === 'cancelada' && <p className="faint">A sessão de presenças foi cancelada.</p>}
          {p.counts ? (
            <dl className="ev-stats">
              <div><dt>Presentes</dt><dd>{p.counts.presente}</dd></div>
              <div><dt>Faltas justificadas</dt><dd>{p.counts.justificada}</dd></div>
              <div><dt>Faltas injustificadas</dt><dd>{p.counts.injustificada}</dd></div>
            </dl>
          ) : (
            <p>A tua presença: <strong>{p.mine ? PRES_STATUS[p.mine] : 'por registar'}</strong></p>
          )}
        </>
      ) : <p className="faint">Ainda não há presenças registadas.</p>}
      <div className="btn-row">
        {canOpen ? (
          <button type="button" className="btn" disabled={action.busy} onClick={() => void open()}>
            <ClipboardCheck size={16} aria-hidden="true" /> Registar presenças
          </button>
        ) : p ? (
          <Link className="btn secondary" to={`/presencas/sessoes/${p.id}`}>Ver presenças <ArrowRight size={16} aria-hidden="true" /></Link>
        ) : null}
      </div>
      <ErrorBox error={action.error} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Ata e tarefas
// ---------------------------------------------------------------------------
export function AtaPanel({ e, l }: { e: CalDetail; l: EventLinksData }) {
  const atas = visibleAtas(l);
  const canWrite = !!l.ata_writer && atas.length === 0 && e.status === 'ativo';
  const tasks = l.tarefas ?? [];
  return (
    <>
      <Section id="ev-ata-h" title="Ata" icon={<FileText size={18} aria-hidden="true" />}>
        {atas.length > 0 ? (
          <div className="btn-row">
            {atas.map((m) => (
              <Link key={m.id} className="btn secondary" to={`/atas-e-tarefas/atas/${m.ata_id}`}>
                <FileText size={16} aria-hidden="true" /> Abrir ata
              </Link>
            ))}
          </div>
        ) : canWrite ? (
          <div className="btn-row">
            <Link className="btn" to={`/atas-e-tarefas/nova?evento=${e.id}`}><FileText size={16} aria-hidden="true" /> Escrever ata</Link>
          </div>
        ) : <p className="faint">Ainda não há ata.</p>}
      </Section>
      {tasks.length > 0 && (
        <Section id="ev-tasks-h" title="Tarefas" icon={<ListChecks size={18} aria-hidden="true" />}>
          <ul className="list ev-tasks">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link className="list-item ev-task" to={t.ata_id ? `/atas-e-tarefas/atas/${t.ata_id}` : '/atas-e-tarefas/minhas'}>
                  <span className="grow">
                    <span className="ev-task-title">{t.title}</span>
                    <span className="faint ev-task-meta">
                      {[t.responsible_name ?? t.team_name ?? 'Sem responsável', t.due_date ? `até ${formatDay(t.due_date)}` : 'sem prazo'].join(' · ')}
                    </span>
                  </span>
                  <Badge label={t.overdue ? 'Em atraso' : TASK_STATUS[t.exec_status] ?? t.exec_status}
                    tone={t.overdue ? 'attention' : t.exec_status === 'concluida' || t.exec_status === 'feita' ? 'ok' : t.exec_status === 'em_curso' ? 'progress' : 'neutral'} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------
export function MaterialPanel({ e, l }: { e: CalDetail; l: EventLinksData }) {
  const res = l.reservas ?? [];
  const buy = l.compras ?? [];
  const manage = !!l.inv_can_manage && e.status === 'ativo';
  return (
    <Section id="ev-mat-h" title="Material" icon={<Package size={18} aria-hidden="true" />}
      action={manage ? <Link className="btn secondary ev-head-btn" to="/inventario">Reservar no Inventário</Link> : undefined}>
      {res.length > 0 && (
        <>
          <h3 className="label">Reservado</h3>
          <ul className="list">
            {res.map((r) => (
              <li key={r.id}><Link className="list-item" to={`/inventario/artigo/${r.item_id}`}>
                <span className="grow ellipsis">{r.item}</span><span className="faint">{r.quantity} {r.unit}{r.status === 'concluida' ? ' · concluída' : ''}</span>
              </Link></li>
            ))}
          </ul>
        </>
      )}
      {buy.length > 0 && (
        <>
          <h3 className="label"><ShoppingCart size={15} aria-hidden="true" /> A comprar</h3>
          <ul className="list">
            {buy.map((c) => (
              <li key={c.id}><Link className="list-item" to="/inventario/comprar">
                <span className="grow ellipsis">{c.name}</span><span className="faint">{c.quantity} {c.unit} · {c.status === 'comprado' ? 'comprado' : 'por comprar'}</span>
              </Link></li>
            ))}
          </ul>
        </>
      )}
      {!res.length && !buy.length && <p className="faint">Sem material reservado nem compras para esta atividade.</p>}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Finanças (totais; o detalhe fica na Tesouraria, com as permissões dela)
// ---------------------------------------------------------------------------
export function FinancasPanel({ e, l }: { e: CalDetail; l: EventLinksData }) {
  const f = l.financas!;
  const hasData = f.tem_dados ?? true;
  return (
    <Section id="ev-fin-h" title="Finanças" icon={<Wallet size={18} aria-hidden="true" />}>
      {hasData ? (
        <dl className="ev-stats">
          <div><dt>Orçamento</dt><dd>{formatEuros(f.orcamento.resultado)}</dd></div>
          <div><dt>Efetivo</dt><dd>{formatEuros(f.efetivo.resultado)}</dd></div>
          {f.por_confirmar.resultado !== 0 && <div><dt>Por confirmar</dt><dd>{formatEuros(f.por_confirmar.resultado)}</dd></div>}
        </dl>
      ) : <p className="faint">Sem orçamento nem movimentos.</p>}
      <div className="btn-row">
        <Link className="btn secondary" to={`/tesouraria/atividades#a-${e.id}`}>
          {hasData ? 'Ver na Tesouraria' : 'Preparar orçamento'} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </Section>
  );
}
