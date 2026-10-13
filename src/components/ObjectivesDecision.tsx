// Registo da reunião de Equipa para um pedido por objetivos: cada objetivo
// fica «Validado» ou «A rever» (com comentário). O trilho só fica validado
// quando todos os seus objetivos estiverem aceites — o servidor decide isso.
import { useState } from 'react';
import { useActiveSection } from '../lib/session';
import { call, type RequestDetail } from '../lib/api';
import { useAction } from '../lib/useAction';
import { todayIso } from '../lib/labels';
import type { RequestVersion } from '../lib/types';
import { ConfirmButton, ErrorBox, Field, Notice } from './ui';

type Choice = { accepted: boolean | null; comment: string };

export function ObjectivesDecision({ detail, current, isTeamGuia, onDone }: { detail: RequestDetail; current: RequestVersion; isTeamGuia: boolean; onDone: (message: string) => void }) {
  const s = useActiveSection();
  const { request } = detail;
  const trail = s.catalog.trailById.get(request.trail_id);
  const rows = detail.objectives.filter((o) => o.version_id === current.id);
  const others = (trail?.catalog_objectives ?? []).filter((o) => !rows.some((r) => r.objective_id === o.id));
  const action = useAction();
  const [meeting, setMeeting] = useState(todayIso());
  const [general, setGeneral] = useState('');
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(rows.map((r) => [r.objective_id, { accepted: null, comment: '' }])));
  const set = (id: string, patch: Partial<Choice>) => setChoices((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const missing = rows.filter((r) => choices[r.objective_id]?.accepted === null);
  const reviewWithoutComment = rows.filter((r) => choices[r.objective_id]?.accepted === false && !choices[r.objective_id].comment.trim()).length > 0 && !general.trim();
  const outcome: Record<string, string> = {
    validado_equipa: 'Decisão registada. Todos os objetivos do trilho estão validados: o trilho fica validado.',
    objetivos_validados: 'Decisão registada. Os objetivos ficam validados; o trilho continua por fechar.',
    devolvido: 'Decisão registada. O pedido fica «A rever» para o pioneiro corrigir e reenviar.',
  };

  return (
    <section className="card">
      <h2>Registo da reunião de Equipa</h2>
      <Notice kind="info">
        <p className="prose">
          Regista aqui a decisão tomada <strong>em reunião de Equipa</strong>, objetivo a objetivo. Aceitar um objetivo não fecha o trilho:
          o trilho só fica validado quando todos os seus objetivos estiverem aceites.
          {s.isDirigente && !isTeamGuia ? ' (Registo pela Equipa de Animação — ex.: pedido do próprio guia.)' : ''}
        </p>
      </Notice>
      {others.length > 0 && <p className="faint">Fora deste pedido: {others.map((o) => o.code).join(', ')}.</p>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {request.status === 'submetido' && (
        <button type="button" className="btn secondary" disabled={action.busy}
          onClick={() => action.run(() => call('mark_request_in_review', { p_request: request.id }), 'Pedido marcado como em análise.')}>
          Marcar como em análise
        </button>
      )}
      <div className="obj-decisions">
        {rows.map((r) => {
          const o = trail?.catalog_objectives.find((x) => x.id === r.objective_id);
          const c = choices[r.objective_id];
          return (
            <fieldset key={r.id} className="obj-decision">
              <legend><span className="code">{r.objective_code}</span> <span className="prose">{o?.text}</span></legend>
              <div className="segmented" role="radiogroup" aria-label={`Decisão sobre ${r.objective_code}`}>
                <label className="segment"><input type="radio" name={`d-${r.id}`} checked={c.accepted === true} onChange={() => set(r.objective_id, { accepted: true })} /> <span>Validado</span></label>
                <label className="segment"><input type="radio" name={`d-${r.id}`} checked={c.accepted === false} onChange={() => set(r.objective_id, { accepted: false })} /> <span>A rever</span></label>
              </div>
              {c.accepted !== null && (
                <Field label={c.accepted ? `Comentário sobre ${r.objective_code} (opcional)` : `O que falta em ${r.objective_code}?`} htmlFor={`c-${r.id}`}>
                  <textarea id={`c-${r.id}`} value={c.comment} maxLength={4000} style={{ minHeight: 60 }} onChange={(e) => set(r.objective_id, { comment: e.target.value })} />
                </Field>
              )}
            </fieldset>
          );
        })}
      </div>
      <Field label="Data da reunião de Equipa" htmlFor="meeting">
        <input id="meeting" type="date" value={meeting} max={todayIso()} onChange={(e) => setMeeting(e.target.value)} required />
      </Field>
      <Field label="Comentário geral (opcional)" htmlFor="general">
        <textarea id="general" value={general} maxLength={4000} onChange={(e) => setGeneral(e.target.value)} style={{ minHeight: 60 }} />
      </Field>
      {missing.length > 0 && <p className="faint">Falta decidir: {missing.map((m) => m.objective_code).join(', ')}.</p>}
      {reviewWithoutComment && <p className="faint">Explica o que falta nos objetivos a rever.</p>}
      <ConfirmButton className="btn" confirmLabel="Registar decisão" disabled={action.busy || !meeting || missing.length > 0 || reviewWithoutComment}
        description="A decisão é comunicada ao pioneiro e ao Conselho de Guias."
        onConfirm={() =>
          action.run(() => call<string>('record_objectives_decision', {
            p_request: request.id, p_expected_version: current.version_no, p_meeting_date: meeting, p_comment: general,
            p_decisions: rows.map((r) => ({ objective_id: r.objective_id, accepted: choices[r.objective_id].accepted, comment: choices[r.objective_id].comment })),
          })).then((res) => { if (res.ok) onDone(outcome[res.value ?? ''] ?? 'Decisão registada.'); })
        }>
        Registar decisão
      </ConfirmButton>
    </section>
  );
}
