// Configuração do calendário (quem gere): feriado municipal e outros dias relevantes. O servidor volta a verificar a permissão.
import { useState, type FormEvent } from 'react';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { useActiveSection } from '../../lib/session';
import { ConfirmButton, ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { useModuleCtx } from '../ModuleShell';
import { formatDay } from '../common';
import { useCalConfig, type CalConfig } from './Overview';
import type { SpecialDay } from './holidays';
import { DateInput } from '../../components/DateInput';

export function Config() {
  const { can } = useModuleCtx();
  const cfg = useCalConfig();
  const title = 'Dias especiais';
  if (!can('calendario.gerir', true)) {
    return (
      <>
        <PageTitle title={title} back="/calendario" />
        <Notice kind="info">Só os dirigentes e quem tem a permissão «Gerir atividades» podem configurar o calendário.</Notice>
      </>
    );
  }
  if (cfg.isLoading) return <Loading />;
  if (cfg.error || !cfg.data) return <><PageTitle title={title} back="/calendario" /><ErrorBox error={cfg.error} retry={() => cfg.refetch()} /></>;
  return (
    <>
      <PageTitle title={title} back="/calendario" />
      <p className="prose faint cal-config-intro">
        Os feriados nacionais (incluindo os móveis, como a Sexta-feira Santa e o Corpo de Deus) aparecem automaticamente.
        Aqui acrescentas o feriado municipal e outros dias relevantes para a secção.
      </p>
      <SpecialDays cfg={cfg.data} />
    </>
  );
}

type Draft = { id: string | null; day: string; name: string; kind: 'municipal' | 'relevante'; recurring: boolean };
const blank = (): Draft => ({ id: null, day: '', name: '', kind: 'municipal', recurring: true });

function SpecialDays({ cfg }: { cfg: CalConfig }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const [f, setF] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!f.day) err.day = 'Indica a data.';
    if (!f.name.trim()) err.name = 'Indica o nome do dia.';
    setErrors(err);
    if (Object.keys(err).length) return;
    const r = await action.run(() => call('cal_special_day_save', {
      p_section: section, p_id: f.id, p_data: { day: f.day, name: f.name.trim(), kind: f.kind, recurring: f.recurring },
    }), f.id ? 'Dia corrigido.' : 'Dia acrescentado.');
    if (r.ok) setF(blank());
  };
  const edit = (d: SpecialDay) => {
    setErrors({});
    action.clear();
    setF({ id: d.id, day: d.day, name: d.name, kind: d.kind, recurring: d.recurring });
    document.getElementById('cal-sd-date')?.focus();
  };
  const remove = (d: SpecialDay) => action.run(() => call('cal_special_day_remove', { p_section: section, p_id: d.id }), 'Dia retirado.');

  return (
    <section className="card" aria-labelledby="cal-sd-h">
      <h2 id="cal-sd-h">Feriado municipal e dias relevantes</h2>
      {cfg.special_days.length ? (
        <ul className="list cal-sd-list">
          {cfg.special_days.map((d) => (
            <li key={d.id} className="list-item cal-sd-item">
              <span className="grow">
                <span className="cal-event-title">{d.name}</span>
                <span className="cal-event-meta faint">
                  {d.recurring ? `Todos os anos a ${formatDay(d.day).slice(0, 5)}` : formatDay(d.day)} · {d.kind === 'municipal' ? 'Feriado municipal' : 'Dia relevante'}
                </span>
              </span>
              <span className="cal-sd-actions">
                <button type="button" className="btn ghost" onClick={() => edit(d)} aria-label={`Corrigir ${d.name}`}>Corrigir</button>
                <ConfirmButton className="btn ghost" confirmLabel="Retirar" onConfirm={() => remove(d)} description={`Retirar «${d.name}» do calendário?`}>
                  Retirar
                </ConfirmButton>
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="faint">Ainda não há dias configurados. Acrescenta o feriado municipal do teu concelho.</p>}

      <form className="cal-form cal-sd-form" onSubmit={submit} noValidate aria-label={f.id ? 'Corrigir dia' : 'Acrescentar dia'}>
        <h3 className="label">{f.id ? 'Corrigir dia' : 'Acrescentar dia'}</h3>
        <div className="grid-2">
          <Field label="Data" htmlFor="cal-sd-date">
            <DateInput id="cal-sd-date" value={f.day} onChange={(e) => set('day', e.target.value)} aria-invalid={!!errors.day} />
          </Field>
          <Field label="Nome" htmlFor="cal-sd-name">
            <input id="cal-sd-name" maxLength={120} value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} placeholder="ex.: Feriado municipal" />
          </Field>
        </div>
        {errors.day && <p className="field-error">{errors.day}</p>}
        {errors.name && <p className="field-error">{errors.name}</p>}
        <div className="radio-row" role="radiogroup" aria-label="Tipo">
          <label className="radio"><input type="radio" name="sd-kind" checked={f.kind === 'municipal'} onChange={() => set('kind', 'municipal')} /> Feriado municipal</label>
          <label className="radio"><input type="radio" name="sd-kind" checked={f.kind === 'relevante'} onChange={() => set('kind', 'relevante')} /> Dia relevante</label>
        </div>
        <label className="checkbox"><input type="checkbox" checked={f.recurring} onChange={(e) => set('recurring', e.target.checked)} /> Repetir todos os anos</label>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <div className="btn-row">
          <button type="submit" className="btn" disabled={action.busy}>{f.id ? 'Guardar correção' : 'Acrescentar'}</button>
          {f.id && <button type="button" className="btn secondary" onClick={() => setF(blank())}>Cancelar correção</button>}
        </div>
      </form>
    </section>
  );
}
