// Página do trilho: os objetivos oficiais e o pedido de validação por objetivos
// (Objetivos → Justificação → Enviar). A escolha para a etapa e as vivências
// continuam disponíveis, mas não são passos obrigatórios do pedido.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, NotebookPen, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSubject } from '../components/meu/useSubject';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { errorMessage } from '../lib/errors';
import { activeRequest, openPath } from '../lib/progress';
import { activeChoice, CATEGORY_LABEL, objectiveStates, trailCategory } from '../lib/meuprogresso';
import { formatDate, todayIso } from '../lib/labels';
import type { CatalogTrail, MemberProgress } from '../lib/types';
import { Badge, ConfirmButton, ErrorBox, Field, Loading, Notice } from '../components/ui';
import { Crumbs } from '../components/nav';
import { ObjectiveList, PedidoObjetivos } from '../components/meu/PedidoObjetivos';
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
      {p && <Link to={pedidosTo} className="btn ghost">{subject.isSelf ? 'Os meus pedidos' : 'Pedidos'}</Link>}
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
  const r = activeRequest(p.requests, trail.key);
  const exps = subject.experiences.filter((e) => e.trail_key === trail.key);

  return (
    <div className="trail-page">
      {crumbs}
      <header className="trail-head">
        <span className="area-code" aria-hidden="true">{area.code}</span>
        <h1 className="grow" style={{ margin: 0 }}>{trail.name}</h1>
        <Badge {...CATEGORY_LABEL[cat]} />
      </header>
      {subject.consulted && <p className="consult-note">Modo de consulta · {subject.consulted.full_name}</p>}

      {subject.isSelf ? (
        <PedidoObjetivos key={trail.key} trail={trail} area={area} progress={p} membershipId={subject.membership.id} pedidosTo={pedidosTo}
          historicalEnabled={!!subject.settings?.historical_progress_enabled} />
      ) : (
        <section className="card" id="pedido" aria-labelledby="h-obj">
          <h2 id="h-obj">Objetivos</h2>
          <ObjectiveList trail={trail} states={objectiveStates(trail, p)} />
          {r ? <Link to={`/revisoes/pedido/${r.id}`} className="btn ghost">Ver o pedido</Link> : <p className="faint">Ainda não há pedido de validação para este trilho.</p>}
        </section>
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
      {trail.catalog_objectives.map((o) => (
        <div key={o.id} className="objective">
          <span className="code">{o.code}</span>
          <div>
            <p className="prose" style={{ margin: 0 }}>{o.text}</p>
            {o.pending_note && <p className="faint" style={{ margin: '4px 0 0' }}><AlertTriangle size={13} aria-hidden="true" /> Pendente: {o.pending_note}</p>}
          </div>
        </div>
      ))}
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
      <p className="faint prose">Um diário opcional, só teu. Não é preciso registar vivências para pedir a validação de objetivos.</p>
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
