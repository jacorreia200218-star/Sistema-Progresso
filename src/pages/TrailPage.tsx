// Página do trilho: área e nome do trilho, todos os objetivos oficiais e o
// pedido de validação do trilho completo (justificação → Pedir validação).
// A associação à etapa (negociação) e as vivências continuam disponíveis, mas
// não são passos obrigatórios do pedido.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, NotebookPen, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSubject } from '../components/meu/useSubject';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { errorMessage } from '../lib/errors';
import { openPath } from '../lib/progress';
import { activeChoice, CATEGORY_LABEL, legacyObjectiveHistory, trailCategory } from '../lib/meuprogresso';
import { formatDate, formatDateTime, todayIso } from '../lib/labels';
import type { CatalogTrail, MemberProgress } from '../lib/types';
import { Badge, ConfirmButton, ErrorBox, Field, Loading, Notice } from '../components/ui';
import { Crumbs } from '../components/nav';
import { PedidoTrilho, TrailObjectives } from '../components/meu/PedidoTrilho';
import { ConsultHeader } from '../components/meu/ConsultHeader';
import { AREA_ICON } from '../components/meu/AreasView';
import { stageName } from '../components/StagePanel';
import NotFound from './NotFound';

type Subj = ReturnType<typeof useSubject>;

export default function TrailPage() {
  const { key } = useParams();
  const subject = useSubject();
  const location = useLocation();
  const { catalog } = subject;
  const trail = key ? catalog.trailByKey.get(key) : undefined;
  const p = subject.progress.data;

  useEffect(() => {
    if (location.hash && p) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }));
  }, [location.hash, p]);

  if (!trail) return <NotFound />;
  const area = catalog.areaById.get(trail.area_id)!;
  const sq = subject.q ? `&${subject.q}` : '';
  const areaTo = `/meu-progresso?vista=areas&area=${area.code}${sq}`;
  const areasTo = `/meu-progresso?vista=areas${sq}`;
  const pedidosTo = `/meu-progresso?vista=pedidos${sq}`;
  const crumbs = (
    <Crumbs items={[
      { label: 'Início', to: '/' },
      { label: subject.consulted ? `Progresso de ${subject.consulted.full_name.split(' ')[0]}` : 'Progresso', to: areasTo },
      { label: area.name, to: areaTo },
      { label: trail.name },
    ]} />
  );
  const backLinks = (
    <nav className="row page-links" aria-label="Navegação">
      <Link to={areaTo} className="btn ghost"><ArrowLeft size={16} aria-hidden="true" /> Voltar aos trilhos</Link>
      <Link to={areasTo} className="btn ghost">Voltar às áreas</Link>
      {p && subject.isSelf && <Link to={pedidosTo} className="btn ghost">Os meus pedidos</Link>}
    </nav>
  );

  if (subject.progress.isLoading || subject.pathLoading) return <Loading />;
  if (!p) {
    return (
      <>
        {crumbs}
        <h1>{trail.name}</h1>
        <Objectives trail={trail} />
        <TrailMore trail={trail} />
        <p className="faint prose">Para ver o estado e pedir validação, abre este trilho a partir de «Progresso».</p>
      </>
    );
  }

  const cat = trailCategory(trail, p);
  const exps = subject.experiences.filter((e) => e.trail_key === trail.key);
  const choice = activeChoice(p, trail.key);
  const choiceStage = choice ? stageName(catalog, p.paths.find((x) => x.id === choice.stage_path_id)?.stage_key ?? '') : null;
  const legacy = legacyObjectiveHistory(trail, p);
  const Icon = AREA_ICON[area.code];

  return (
    <div className="trail-page">
      {crumbs}
      <ConsultHeader subject={subject} />
      <header className={`trail-head area-${area.code}`}>
        <span className="ac-icon" aria-hidden="true">{Icon && <Icon size={20} />}</span>
        <div className="grow">
          <span className="faint">Área {area.name}</span>
          <h1 style={{ margin: 0 }}>{trail.name}</h1>
        </div>
        <Badge {...CATEGORY_LABEL[cat]} />
      </header>
      <p className="faint trail-stage">
        {choice
          ? `${choice.status === 'confirmada' ? 'Associado à etapa' : 'Proposto para a etapa'} ${choiceStage}${choice.status === 'proposta' ? ' (aguarda negociação)' : ''}.`
          : 'Ainda não associado a uma etapa. A validação do trilho e a associação à etapa são passos diferentes.'}
      </p>

      <PedidoTrilho key={trail.key} trail={trail} progress={p} membershipId={subject.isSelf ? subject.membership.id : subject.subjectId ?? ''} pedidosTo={pedidosTo}
        historicalEnabled={!!subject.settings?.historical_progress_enabled} readOnly={!subject.isSelf} />

      {legacy.length > 0 && (
        <details className="card more-card">
          <summary>Histórico por objetivos (modelo anterior)</summary>
          <p className="faint prose">Decisões registadas objetivo a objetivo antes de a validação passar a ser feita por trilho. Ficam como histórico e não fecham o trilho.</p>
          <ul className="list">
            {legacy.map((o) => (
              <li key={o.id} className="list-item">
                <span className="code">{o.objective_code}</span>
                <span className="grow">{o.decision === 'aceite' ? 'Aceite' : 'A rever'}{o.comment ? ` · «${o.comment}»` : ''}</span>
                <span className="faint nowrap">{formatDateTime(o.decided_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <TrailMore trail={trail} />

      <details className="card more-card">
        <summary>Etapa e vivências (opcional)</summary>
        <ChoiceSection subject={subject} trail={trail} progress={p} />
        {subject.isSelf && <ExperiencesSection trail={trail} membershipId={subject.membership.id} items={exps} />}
      </details>

      {backLinks}
    </div>
  );
}

function Objectives({ trail }: { trail: CatalogTrail }) {
  return (
    <section className="card" aria-labelledby="h-obj">
      <h2 id="h-obj">Objetivos</h2>
      <TrailObjectives trail={trail} />
    </section>
  );
}

/** Explicação, palavras-chave, exemplos e referência ao manual: só quando se abrem. */
function TrailMore({ trail }: { trail: CatalogTrail }) {
  return (
    <div className="card">
      <details className="more-inner" style={{ borderTop: 0 }}>
        <summary>Explicação e palavras-chave</summary>
        <p className="prose" style={{ whiteSpace: 'pre-line' }}>{trail.framing}</p>
        {trail.pending_note && <Notice kind="warn"><p><strong>Ponto pendente de confirmação.</strong> {trail.pending_note}</p></Notice>}
        {trail.keywords.length > 0 && <p className="faint">{trail.keywords.join(' · ')}</p>}
      </details>
      {trail.opportunities.length > 0 && (
        <details className="more-inner">
          <summary>Ver exemplos</summary>
          <p className="faint prose">Sugestões de oportunidades educativas do manual (exemplos, não obrigatórias). Realizar uma oportunidade não valida o trilho por si.</p>
          <ul className="tight">{trail.opportunities.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </details>
      )}
      <details className="more-inner">
        <summary>Referência</summary>
        <p className="faint">Manual do Dirigente — Sistema de Progresso, p. {trail.source_page}.</p>
      </details>
    </div>
  );
}

function ChoiceSection({ subject, trail, progress }: { subject: Subj; trail: CatalogTrail; progress: MemberProgress }) {
  const action = useAction();
  const [planned, setPlanned] = useState('');
  const { catalog } = subject;
  const area = catalog.areaById.get(trail.area_id)!;
  const path = openPath(progress.paths);
  const choiceHere = activeChoice(progress, trail.key);
  const areaConfirmed = path ? progress.choices.find((c) => c.stage_path_id === path.id && c.area_code === area.code && c.status === 'confirmada') : undefined;
  const areaProposed = path ? progress.choices.find((c) => c.stage_path_id === path.id && c.area_code === area.code && c.status === 'proposta') : undefined;
  const pathBusy = !!(path && progress.stageRequests.some((r) => r.stage_path_id === path.id && (r.status === 'submetido' || r.status === 'decidido_conselho')));
  const canPropose = subject.isSelf && path && !choiceHere && !areaProposed && !pathBusy;
  if (!path && !choiceHere) return null;
  return (
    <section className="sub-section" id="escolha" aria-labelledby="h-escolha">
      <h3 id="h-escolha">Escolha para a etapa</h3>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {choiceHere ? (
        <p>
          {choiceHere.status === 'confirmada' ? 'Confirmado' : 'Proposto (aguarda negociação)'} para a etapa{' '}
          <strong>{stageName(catalog, progress.paths.find((x) => x.id === choiceHere.stage_path_id)?.stage_key ?? '')}</strong>.
        </p>
      ) : areaConfirmed ? (
        <p className="faint">Nesta etapa, a área {area.name} tem «{catalog.trailById.get(areaConfirmed.trail_id)?.name}» confirmado.{subject.isSelf ? ' Podes propor uma troca, negociada com a Equipa de Animação.' : ''}</p>
      ) : areaProposed ? (
        <p className="faint">{subject.isSelf ? 'Já tens uma proposta pendente nesta área.' : 'Há uma proposta pendente nesta área.'}</p>
      ) : (
        <p className="faint prose">Ainda sem trilho escolhido nesta área para a etapa.</p>
      )}
      {choiceHere?.status === 'proposta' && subject.isSelf && (
        <button type="button" className="btn secondary" disabled={action.busy} onClick={() => action.run(() => call('withdraw_choice', { p_choice: choiceHere.id }), 'Proposta retirada.')}>Retirar proposta</button>
      )}
      {canPropose && (
        <form onSubmit={(e) => { e.preventDefault(); action.run(() => call('propose_choice', { p_stage_path: path!.id, p_trail: trail.id, p_planned: planned, p_replaces: areaConfirmed?.id ?? null }), areaConfirmed ? 'Proposta de troca enviada à Equipa de Animação.' : 'Proposta enviada à Equipa de Animação.').then((res) => res.ok && setPlanned('')); }}>
          <Field label="Oportunidades educativas que pensas viver" htmlFor="planned" hint="O manual sugere pelo menos duas por trilho — é uma orientação, não um mínimo (p. 11).">
            <textarea id="planned" aria-describedby="planned-hint" value={planned} onChange={(e) => setPlanned(e.target.value)} style={{ minHeight: 70 }} />
          </Field>
          <button className="btn" disabled={action.busy}>{areaConfirmed ? 'Propor troca' : `Propor para a etapa ${stageName(catalog, path!.stage_key)}`}</button>
        </form>
      )}
    </section>
  );
}

function ExperiencesSection({ trail, membershipId, items }: { trail: CatalogTrail; membershipId: string; items: { id: string; title: string; description: string; occurred_on: string | null }[] }) {
  const action = useAction();
  const [form, setForm] = useState({ title: '', description: '', occurred_on: '' });
  async function add(e: FormEvent) {
    e.preventDefault();
    const res = await action.run(async () => {
      const { error } = await supabase.from('experiences').insert({
        membership_id: membershipId, trail_key: trail.key, title: form.title.trim(), description: form.description, occurred_on: form.occurred_on || null,
      });
      if (error) throw new Error(errorMessage(error));
    }, 'Vivência registada.');
    if (res.ok) setForm({ title: '', description: '', occurred_on: '' });
  }
  return (
    <section className="sub-section" id="vivencias" aria-labelledby="h-viv">
      <div className="card-title"><NotebookPen size={18} aria-hidden="true" color="var(--green-ink)" /><h3 id="h-viv" style={{ margin: 0 }}>Vivências registadas</h3></div>
      <p className="faint prose">Um diário opcional, só teu. Não é preciso registar vivências para pedir a validação do trilho.</p>
      {items.length > 0 ? (
        <ul className="list">
          {items.map((x) => (
            <li key={x.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className="grow">
                <strong>{x.title}</strong> <span className="faint">· {x.occurred_on ? formatDate(x.occurred_on) : 'sem data'}</span>
                {x.description && <span className="muted" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{x.description}</span>}
              </span>
              <ConfirmButton className="btn ghost icon-btn" confirmLabel="Apagar" disabled={action.busy}
                onConfirm={() => action.run(async () => { const { error } = await supabase.from('experiences').delete().eq('id', x.id); if (error) throw new Error(errorMessage(error)); }, 'Vivência apagada.')}>
                <Trash2 size={16} aria-label="Apagar vivência" />
              </ConfirmButton>
            </li>
          ))}
        </ul>
      ) : <p className="faint">Ainda não registaste vivências neste trilho.</p>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <form onSubmit={add} className="exp-form">
        <div className="grid-2">
          <Field label="O que viveste?" htmlFor="exp-t">
            <input id="exp-t" type="text" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Data (opcional)" htmlFor="exp-d">
            <input id="exp-d" type="date" max={todayIso()} value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} />
          </Field>
        </div>
        <Field label="Reflexão (opcional)" htmlFor="exp-x">
          <textarea id="exp-x" maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={{ minHeight: 70 }} />
        </Field>
        <button className="btn secondary" disabled={action.busy || !form.title.trim()}>{action.busy ? 'A guardar…' : 'Registar vivência'}</button>
      </form>
    </section>
  );
}
