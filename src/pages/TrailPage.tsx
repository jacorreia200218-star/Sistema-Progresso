// Página do trilho: o que tenho de atingir, o que já fiz e a ação seguinte —
// incluindo o pedido de validação, preenchido e submetido aqui mesmo.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, MessageSquare, NotebookPen, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSubject } from '../components/meu/useSubject';
import { call, fetchRequest } from '../lib/api';
import { useAction } from '../lib/useAction';
import { errorMessage } from '../lib/errors';
import { activeRequest, openPath } from '../lib/progress';
import { activeChoice, CATEGORY_LABEL, lastFeedback, trailCategory, validationInfo } from '../lib/meuprogresso';
import { decisionLabel, formatDate, formatDateTime, requestKindLabel, requestStatusLabel, todayIso } from '../lib/labels';
import type { CatalogTrail, MemberProgress } from '../lib/types';
import { Badge, ConfirmButton, ErrorBox, Field, Loading, Notice } from '../components/ui';
import { Crumbs } from '../components/nav';
import { OwnerRequestPanel, VersionContent } from '../components/RequestEditor';
import { stageName } from '../components/StagePanel';
import NotFound from './NotFound';

type Subj = ReturnType<typeof useSubject>;

/**
 * Próximo passo do trilho. Para o próprio, com a ação disponível; em modo de
 * consulta, descrito na terceira pessoa e sem convites a ações indisponíveis.
 */
function nextStep(trail: CatalogTrail, p: MemberProgress, subject: Subj, expCount: number): { text: string; target?: string; label?: string } {
  const cat = trailCategory(trail, p, { [trail.key]: expCount });
  const r = activeRequest(p.requests, trail.key);
  const path = openPath(p.paths);
  const choice = activeChoice(p, trail.key);
  const self = subject.isSelf;
  switch (cat) {
    case 'validado':
      return { text: self ? 'Trilho validado. Continua a viver estes objetivos no dia a dia.' : 'Trilho validado.' };
    case 'aguarda':
      return { text: r?.kind === 'historico' ? 'O pedido aguarda a decisão dos dirigentes.' : 'O pedido aguarda a decisão da reunião de Equipa. Submeter não é concluir: o trilho só fica validado depois da decisão.' };
    case 'revisao':
      return self
        ? { text: 'O pedido foi devolvido. Lê o feedback e prepara uma nova versão.', target: 'pedido', label: 'Corrigir o pedido' }
        : { text: 'O pedido foi devolvido; o pioneiro prepara uma nova versão a partir do feedback.' };
    case 'em_desenvolvimento':
      if (r?.status === 'rascunho') {
        return self ? { text: 'Tens um pedido em rascunho. Completa-o e submete quando tiveres alcançado os objetivos.', target: 'pedido', label: 'Continuar o pedido' } : { text: 'O pioneiro tem um pedido em rascunho, ainda não submetido.' };
      }
      if (choice?.status === 'proposta') {
        return { text: self ? 'A tua proposta aguarda negociação com a Equipa de Animação. Entretanto, podes registar vivências.' : 'A proposta aguarda negociação com a Equipa de Animação.', target: self ? 'vivencias' : undefined, label: self ? 'Registar vivência' : undefined };
      }
      return self
        ? { text: 'Vive as oportunidades e regista as vivências. Quando tiveres alcançado os objetivos, pede a validação.', target: 'pedido', label: 'Pedir validação' }
        : { text: 'Trilho em desenvolvimento; ainda sem pedido de validação.' };
    default: {
      const areaCode = subject.catalog.areaById.get(trail.area_id)?.code;
      const areaFree = path && !choice && !p.choices.some((c) => c.stage_path_id === path.id && c.area_code === areaCode && (c.status === 'confirmada' || c.status === 'proposta'));
      if (!self) return { text: areaFree ? `Trilho por iniciar. A área ainda não tem trilho escolhido para a etapa ${stageName(subject.catalog, path!.stage_key)}.` : 'Trilho por iniciar.' };
      if (areaFree) return { text: `Podes propor este trilho para a etapa ${stageName(subject.catalog, path!.stage_key)}.`, target: 'escolha', label: 'Propor para a etapa' };
      return { text: 'Ainda não começaste este trilho. Regista uma vivência quando viveres uma oportunidade relacionada.', target: 'vivencias', label: 'Registar vivência' };
    }
  }
}

export default function TrailPage() {
  const { key } = useParams();
  const subject = useSubject();
  const location = useLocation();
  const { catalog } = subject;
  const trail = key ? catalog.trailByKey.get(key) : undefined;
  const p = subject.progress.data;
  const r = p && trail ? activeRequest(p.requests, trail.key) : undefined;
  const detail = useQuery({ queryKey: ['request', r?.id], queryFn: () => fetchRequest(r!.id), enabled: !!r });
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    if (location.hash && p) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }));
  }, [location.hash, p]);

  if (!trail) return <NotFound />;
  const area = catalog.areaById.get(trail.area_id)!;
  const q = subject.q ? `?${subject.q}` : '';
  const filtro = new URLSearchParams(location.search).get('filtro');
  const extra = `${filtro ? `&filtro=${filtro}` : ''}${subject.q ? `&${subject.q}` : ''}`;
  const areaTo = `/meu-progresso?vista=areas&area=${area.code}${extra}`;
  const percursoTo = `/meu-progresso?vista=caminho${subject.q ? `&${subject.q}` : ''}`;
  const crumbs = (
    <Crumbs items={[
      { label: 'Início', to: '/' },
      { label: subject.consulted ? `Progresso de ${subject.consulted.full_name.split(' ')[0]}` : 'Progresso', to: percursoTo },
      { label: area.name, to: areaTo },
      { label: trail.name },
    ]} />
  );

  if (subject.progress.isLoading || subject.pathLoading) return <Loading />;
  if (!p) {
    return (
      <>
        {crumbs}
        <h1>{trail.name}</h1>
        <Objectives trail={trail} />
        <TrailMore trail={trail} />
        <p className="faint">Para ver o estado e pedir validação, abre este trilho a partir de «Progresso».</p>
      </>
    );
  }

  const exps = subject.experiences.filter((e) => e.trail_key === trail.key);
  const cat = trailCategory(trail, p, { [trail.key]: exps.length });
  const v = validationInfo(r, p.decisions);
  const step = nextStep(trail, p, subject, exps.length);
  const choice = activeChoice(p, trail.key);

  return (
    <div className="trail-page">
      {crumbs}
      <header className="trail-head">
        <span className="area-code" aria-hidden="true">{area.code}</span>
        <h1 className="grow" style={{ margin: 0 }}>{trail.name}</h1>
        <Badge {...CATEGORY_LABEL[cat]} />
      </header>
      {subject.consulted && <p className="consult-note">Modo de consulta · {subject.consulted.full_name}</p>}

      <Objectives trail={trail} />

      <section className="card next-step" aria-labelledby="h-next">
        <h2 id="h-next" className="faint-title">{subject.isSelf ? 'Próximo passo' : 'Próximo passo do pioneiro'}</h2>
        <p className="next-title">{step.text}</p>
        {v && <p className="faint" style={{ margin: '0 0 6px' }}>{v.label} em {formatDate(v.date)}.</p>}
        {step.label && step.target && (
          <a href={`#${step.target}`} className="btn" onClick={(e) => { e.preventDefault(); document.getElementById(step.target!)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{step.label}</a>
        )}
      </section>

      <ChoiceSection subject={subject} trail={trail} progress={p} />

      {choice?.planned_opportunities && (
        <section className="card" aria-labelledby="h-op">
          <h2 id="h-op">Oportunidades escolhidas</h2>
          <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{choice.planned_opportunities}</p>
        </section>
      )}

      {subject.isSelf && <ExperiencesSection trail={trail} membershipId={subject.membership.id} items={exps} />}

      <section className="card" id="pedido" aria-labelledby="h-pedido">
        <h2 id="h-pedido">Pedido de validação</h2>
        {created && r?.status === 'rascunho' && <Notice kind="success">{created}</Notice>}
        {!r ? (
          <NoRequest subject={subject} trail={trail} onCreated={setCreated} />
        ) : detail.isLoading || !detail.data ? <Loading rows={1} /> : (
          <>
            <div className="row" style={{ marginBottom: 8 }}>
              <Badge {...requestStatusLabel[r.status]} />
              {requestKindLabel[r.kind] && <Badge label={requestKindLabel[r.kind]} tone="neutral" icon="clock" />}
              <Link to={subject.isSelf ? `/pedidos/${r.id}` : `/revisoes/pedido/${r.id}`} className="btn ghost">Histórico completo</Link>
            </div>
            <FeedbackBox progress={p} requestId={r.id} />
            {subject.isSelf && <OwnerRequestPanel detail={detail.data} current={detail.data.versions.find((x) => x.version_no === detail.data!.request.current_version)!} />}
            {r.status !== 'rascunho' && r.kind !== 'negociacao' && (
              <VersionContent version={detail.data.versions.find((x) => x.version_no === detail.data!.request.current_version)!}
                attachments={detail.data.attachments.filter((a) => a.version_id === detail.data!.versions.find((x) => x.version_no === detail.data!.request.current_version)?.id)}
                historic={r.kind === 'historico'} compact />
            )}
          </>
        )}
      </section>

      <TrailMore trail={trail} />

      <nav className="row page-links" aria-label="Navegação">
        <Link to={areaTo} className="btn ghost">Voltar à área</Link>
        <Link to={percursoTo} className="btn ghost">Voltar ao percurso</Link>
        <Link to="/" className="btn ghost">Ir para o início</Link>
        <Link to={`/meu-progresso?vista=pedidos${q ? `&${subject.q}` : ''}`} className="btn ghost">Ver pedidos</Link>
      </nav>
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
            <p style={{ margin: 0 }}>{o.text}</p>
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
        <p style={{ whiteSpace: 'pre-line' }}>{trail.framing}</p>
        {trail.pending_note && <Notice kind="warn"><p><strong>Ponto pendente de confirmação.</strong> {trail.pending_note}</p></Notice>}
        {trail.keywords.length > 0 && <p className="faint">{trail.keywords.join(' · ')}</p>}
      </details>
      {trail.opportunities.length > 0 && (
        <details className="more-inner">
          <summary>Ver exemplos</summary>
          <p className="faint">Sugestões de oportunidades educativas do manual (exemplos, não obrigatórias). Realizar uma oportunidade não valida o trilho por si.</p>
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

function FeedbackBox({ progress, requestId }: { progress: MemberProgress; requestId: string }) {
  const r = progress.requests.find((x) => x.id === requestId);
  const fb = lastFeedback(r, progress.decisions);
  if (!fb) return null;
  return (
    <div className={`feedback ${r?.status === 'devolvido' ? 'feedback-review' : ''}`} style={{ marginBottom: 10 }}>
      <MessageSquare size={15} aria-hidden="true" />
      <div>
        <strong>{decisionLabel[fb.kind]}</strong> <span className="faint">· {formatDateTime(fb.recorded_at)}{fb.meeting_date ? ` · reunião de ${formatDate(fb.meeting_date)}` : ''}</span>
        <p style={{ margin: '2px 0 0' }}>«{fb.comment}»</p>
      </div>
    </div>
  );
}

function NoRequest({ subject, trail, onCreated }: { subject: Subj; trail: CatalogTrail; onCreated: (msg: string) => void }) {
  const action = useAction();
  if (!subject.isSelf) return <p className="faint">Ainda não há pedido de validação para este trilho.</p>;
  // A mensagem fica na secção: este bloco desaparece assim que o pedido existe.
  const create = async (kind: 'normal' | 'historico') => {
    const res = await action.run(() => call<string>('create_trail_request', { p_membership: subject.membership.id, p_trail: trail.id, p_kind: kind }));
    if (res.ok) onCreated('Rascunho criado. Preenche e submete quando estiveres pronto.');
  };
  return (
    <>
      <p className="faint">
        O pedido fica em rascunho até o submeteres. Depois segue para a reunião de Equipa; o trilho só fica «Validado» depois da decisão.
      </p>
      <ErrorBox error={action.error} />
      <div className="btn-row">
        <button type="button" className="btn" disabled={action.busy} aria-busy={action.busy} onClick={() => create('normal')}>
          {action.busy ? 'A preparar…' : 'Pedir validação'}
        </button>
        {subject.settings?.historical_progress_enabled && (
          <ConfirmButton confirmLabel="Criar pedido de progresso anterior" disabled={action.busy}
            description="Para trilhos que já concluíste antes de usar a aplicação. Segue diretamente para os dirigentes."
            onConfirm={() => create('historico')}>
            Já concluí antes
          </ConfirmButton>
        )}
      </div>
    </>
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
    <section className="card" id="escolha" aria-labelledby="h-escolha">
      <h2 id="h-escolha">Escolha para a etapa</h2>
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
        <p className="faint">Ainda sem trilho escolhido nesta área para a etapa.</p>
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
    <section className="card" id="vivencias" aria-labelledby="h-viv">
      <div className="card-title"><NotebookPen size={18} aria-hidden="true" color="var(--green-ink)" /><h2 id="h-viv" style={{ margin: 0 }}>Vivências e reflexões registadas</h2></div>
      <p className="faint">Só tu vês estas vivências. Registar uma atividade não valida o trilho: a validação é feita pelo pedido.</p>
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
