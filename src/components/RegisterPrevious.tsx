// Registo de progresso anterior, só pelos dirigentes: pioneiro, área e trilho (com todos os
// objetivos do trilho), fundamentação e data relevante. Conta como trilho validado; o servidor
// recusa duplicados (um trilho só conta uma vez) e regista quem registou.
import { useEffect, useRef, useState } from 'react';
import { call, type MemberRow } from '../lib/api';
import { useActiveSection } from '../lib/session';
import { useAction } from '../lib/useAction';
import { todayIso } from '../lib/labels';
import { ConfirmButton, ErrorBox, Field, Notice } from './ui';
import { TrailPicker } from './TrailPicker';
import { DateInput } from './DateInput';

export function RegisterPrevious({ member, members, taken, open, initialTrail }: {
  /** Pioneiro já escolhido (página do pioneiro). */
  member?: MemberRow;
  /** Pioneiros por onde escolher (caixa de pedidos). */
  members?: MemberRow[];
  /** Chaves dos trilhos já validados ou com pedido ativo do pioneiro (não aparecem na lista). */
  taken?: (memberId: string) => Set<string>;
  /** Abre o formulário (e leva-o à vista), por exemplo a partir da ação no topo do percurso. */
  open?: boolean;
  /** Trilho já escolhido ao abrir. */
  initialTrail?: string;
}) {
  const s = useActiveSection();
  const action = useAction();
  const [who, setWho] = useState(member?.id ?? '');
  const [trail, setTrail] = useState(initialTrail ?? '');
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    ref.current.open = true;
    ref.current.scrollIntoView({ block: 'start' });
    ref.current.querySelector<HTMLElement>('select, textarea')?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => { if (initialTrail) setTrail(initialTrail); }, [initialTrail]);
  const [comment, setComment] = useState('');
  const [day, setDay] = useState('');
  const t = trail ? s.catalog.trailById.get(trail) : undefined;
  const used = who && taken ? taken(who) : null;
  const name = (member ?? members?.find((m) => m.id === who))?.profiles?.full_name ?? '';

  return (
    <details ref={ref} className="card flat register-previous" open={open} id="registar-anterior">
      <summary>Registar progresso anterior</summary>
      <p className="faint prose">Trilho vivido antes da aplicação. Fica validado como trilho completo, com todos os objetivos.</p>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {!member && (
        <Field label="Pioneiro" htmlFor="rp-m">
          <select id="rp-m" value={who} onChange={(e) => { setWho(e.target.value); setTrail(''); }}>
            <option value="">Escolhe o pioneiro…</option>
            {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.profiles?.full_name ?? '—'}</option>)}
          </select>
        </Field>
      )}
      <TrailPicker catalog={s.catalog} id="rp-t" value={trail} onChange={setTrail} available={(x) => !used?.has(x.key)} />
      {t && t.catalog_objectives.length > 0 && (
        <ul className="objective-hints" aria-label="Objetivos do trilho">
          {t.catalog_objectives.map((o) => <li key={o.id}><span className="code">{o.code}</span> {o.text}</li>)}
        </ul>
      )}
      <Field label="Fundamentação" htmlFor="rp-c"><textarea id="rp-c" value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 70 }} /></Field>
      <Field label="Data relevante" htmlFor="rp-d"><DateInput id="rp-d" max={todayIso()} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      <ConfirmButton className="btn" confirmLabel="Registar" disabled={action.busy || !who || !trail || !comment.trim() || !day}
        description={`O trilho ${t?.name ?? ''} fica validado para ${name}, com a tua fundamentação. O pioneiro e o guia são informados.`}
        onConfirm={async () => {
          const r = await action.run(() => call('recognize_in_negotiation', { p_membership: who, p_trail: trail, p_comment: comment, p_reference_date: day }), 'Progresso anterior registado.');
          if (r.ok) { setTrail(''); setComment(''); setDay(''); }
        }}>
        Registar
      </ConfirmButton>
    </details>
  );
}
