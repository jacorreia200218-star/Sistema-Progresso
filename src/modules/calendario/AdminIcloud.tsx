// Gestão › Calendário iCloud: ligar um calendário partilhado do iCloud (só leitura) ao
// Calendário escutista, ver o estado da sincronização, sincronizar agora, alterar o público
// e os lembretes, e desligar. Só a administração; o servidor verifica tudo.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, RefreshCw } from 'lucide-react';
import { call } from '../../lib/api';
import { useActiveSection } from '../../lib/session';
import { useTeams } from '../../lib/hooks';
import { useAction } from '../../lib/useAction';
import type { Team } from '../../lib/types';
import { Badge, ConfirmButton, ErrorBox, Field, Loading, MoreOptions, Notice } from '../../components/ui';
import { formatDay, formatLisbon } from '../common';
import { REMINDER_OPTIONS, reminderLabel } from './cal';
import { icloudRequest, statsLabel, type IcloudOverview, type IcloudPreview, type IcloudSource, type SyncStats } from './icloudApi';
import './icloud.css';

const STATUS: Record<IcloudSource['status'], { label: string; tone: 'ok' | 'attention' | 'muted' }> = {
  ativa: { label: 'Ativa', tone: 'ok' }, parada: { label: 'Atualizações paradas', tone: 'attention' }, arquivada: { label: 'Arquivada', tone: 'muted' },
};
const range = (a: string | null, b: string | null) => (a && b ? (a === b ? formatDay(a) : `${formatDay(a)} a ${formatDay(b)}`) : '—');

export function AdminIcloud() {
  const section = useActiveSection().membership.section_id;
  const q = useQuery({ queryKey: ['cal-sources', section], queryFn: () => call<IcloudOverview>('cal_sources_list', { p_section: section }) });
  const teams = useTeams(section);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const active = (teams.data ?? []).filter((t) => !t.archived_at);
  const d = q.data;
  return (
    <div className="icloud-admin">
      <p className="faint icloud-intro">Mostra no Calendário escutista as atividades de um calendário partilhado do iCloud. Só leitura: alterações fazem-se no iCloud.</p>
      {d.calendar_status !== 'disponivel' && (
        <Notice kind="info">O Calendário escutista ainda não está publicado: só os testers o veem (espaço de teste). As atividades reais aparecem quando for publicado.</Notice>
      )}
      <p className="faint">
        <Cloud size={14} aria-hidden="true" /> Sincronização automática:{' '}
        {d.auto_sync ? 'de hora a hora.' : 'por ativar (pg_cron no Supabase). Entretanto, usa «Sincronizar agora».'}
      </p>
      {d.sources.map((s) => <SourceCard key={s.id} s={s} teams={active} />)}
      <AddSource teams={active} first={!d.sources.some((s) => s.status !== 'arquivada')} />
    </div>
  );
}

function SourceCard({ s, teams }: { s: IcloudSource; teams: Team[] }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const [mode, setMode] = useState<'parar' | 'arquivar'>('parar');
  const qc = useQueryClient();
  const st = STATUS[s.status];
  // Mesmo quando falha, o estado da fonte (último erro) é relido.
  const sync = (force = false) => action.run(
    () => icloudRequest<{ stats: SyncStats }>({ action: 'sync', section_id: section, source_id: s.id, force })
      .finally(() => qc.invalidateQueries({ queryKey: ['cal-sources', section] })),
    'Sincronizado.',
  );
  return (
    <section className="card" aria-labelledby={`src-${s.id}`}>
      <div className="icloud-head">
        <h3 id={`src-${s.id}`}>{s.name}</h3>
        <span className="icloud-badges">
          <Badge label={s.space === 'real' ? 'Dados reais' : 'Espaço de teste'} tone={s.space === 'real' ? 'progress' : 'neutral'} />
          <Badge label={st.label} tone={st.tone} />
        </span>
      </div>
      <p className="icloud-mask" title="Link guardado no servidor (mostrado só em parte)">{s.url_mask}</p>
      <dl className="icloud-facts">
        <dt>Para</dt><dd>{s.audience === 'equipa' ? `Equipa ${s.team_name ?? '—'}` : 'Toda a secção'}</dd>
        <dt>Lembretes</dt><dd>{s.reminder_minutes.length ? `${s.reminder_minutes.map(reminderLabel).join(', ')} antes` : 'nenhum'}</dd>
        <dt>Atividades</dt><dd>{s.event_count} · {range(s.range_from, s.range_to)}{s.removed_count > 0 && ` · ${s.removed_count} removidas no iCloud`}</dd>
        <dt>Última sincronização</dt>
        <dd>{s.last_success_at ? `${formatLisbon(s.last_success_at)} · ${statsLabel(s.last_stats)}` : 'ainda não'}</dd>
      </dl>
      {s.last_error && (
        <Notice kind="error">
          <strong>Falhou a {formatLisbon(s.last_error_at ?? s.last_attempt_at ?? s.created_at)}</strong>{s.failures > 1 && ` (${s.failures} vezes seguidas)`}: {s.last_error} As atividades já importadas mantêm-se.
        </Notice>
      )}
      {s.last_warning && <Notice kind="warn">{s.last_warning}</Notice>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {s.status === 'ativa' ? (
        <>
          <div className="btn-row">
            <button type="button" className="btn secondary" disabled={action.busy} onClick={() => sync()}>
              <RefreshCw size={16} aria-hidden="true" /> {action.busy ? 'A sincronizar…' : 'Sincronizar agora'}
            </button>
            {s.pending_removals > 0 && (
              <ConfirmButton className="btn ghost" confirmLabel={`Retirar ${s.pending_removals}`} disabled={action.busy}
                description={`Ficam canceladas, com a indicação «removida no iCloud». Atas, tarefas e outros registos ligados mantêm-se.`}
                onConfirm={() => sync(true)}>
                Confirmar remoções ({s.pending_removals})
              </ConfirmButton>
            )}
          </div>
          <MoreOptions label="Alterar ou desligar">
            <EditSource s={s} teams={teams} />
            <fieldset className="cal-fieldset">
              <legend className="label">Desligar</legend>
              <label className="radio"><input type="radio" name={`dc-${s.id}`} checked={mode === 'parar'} onChange={() => setMode('parar')} /> Parar atualizações (as atividades ficam e passam a editar-se na app)</label>
              <label className="radio"><input type="radio" name={`dc-${s.id}`} checked={mode === 'arquivar'} onChange={() => setMode('arquivar')} /> Arquivar (cancela as que ainda não terminaram)</label>
              <ConfirmButton className="btn ghost" confirmLabel="Desligar" disabled={action.busy}
                description="Nada é apagado: atas, tarefas, presenças, material e movimentos ligados mantêm-se. Nada é escrito no iCloud."
                onConfirm={() => action.run(() => call('cal_source_disconnect', { p_section: section, p_source: s.id, p_mode: mode }),
                  mode === 'parar' ? 'Atualizações paradas.' : 'Ligação arquivada.')}>
                Desligar…
              </ConfirmButton>
            </fieldset>
          </MoreOptions>
        </>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn secondary" disabled={action.busy}
            onClick={() => action.run(async () => {
              await call('cal_source_resume', { p_section: section, p_source: s.id });
              await icloudRequest({ action: 'sync', section_id: section, source_id: s.id });
            }, 'Atualizações retomadas.')}>
            Retomar atualizações
          </button>
        </div>
      )}
    </section>
  );
}

function AudienceFields({ idp, audience, setAudience, team, setTeam, teams }: {
  idp: string; audience: 'seccao' | 'equipa'; setAudience: (v: 'seccao' | 'equipa') => void; team: string; setTeam: (v: string) => void; teams: Team[];
}) {
  return (
    <fieldset className="cal-fieldset">
      <legend className="label">Quem vê</legend>
      <div className="radio-row">
        <label className="radio"><input type="radio" name={`${idp}-aud`} checked={audience === 'seccao'} onChange={() => setAudience('seccao')} /> Toda a secção</label>
        <label className="radio"><input type="radio" name={`${idp}-aud`} checked={audience === 'equipa'} onChange={() => setAudience('equipa')} /> Uma equipa</label>
      </div>
      {audience === 'equipa' && (
        <Field label="Equipa" htmlFor={`${idp}-team`}>
          <select id={`${idp}-team`} value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">Escolhe…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
    </fieldset>
  );
}

function ReminderFields({ idp, value, set }: { idp: string; value: number[]; set: (v: number[]) => void }) {
  return (
    <fieldset className="cal-fieldset">
      <legend className="label">Lembretes (por omissão, nenhum)</legend>
      <div className="icloud-reminders" role="group" aria-label="Lembretes antes de cada atividade">
        {REMINDER_OPTIONS.map((o) => (
          <label key={o.minutes} className="checkbox">
            <input type="checkbox" name={`${idp}-rem`} checked={value.includes(o.minutes)}
              onChange={() => set(value.includes(o.minutes) ? value.filter((x) => x !== o.minutes) : [...value, o.minutes].sort((a, b) => b - a))} /> {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EditSource({ s, teams }: { s: IcloudSource; teams: Team[] }) {
  const section = useActiveSection().membership.section_id;
  const action = useAction();
  const [name, setName] = useState(s.name);
  const [audience, setAudience] = useState(s.audience);
  const [team, setTeam] = useState(s.team_id ?? '');
  const [rem, setRem] = useState<number[]>(s.reminder_minutes);
  return (
    <div>
      <Field label="Nome" htmlFor={`nm-${s.id}`}><input id={`nm-${s.id}`} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <AudienceFields idp={`ed-${s.id}`} audience={audience} setAudience={setAudience} team={team} setTeam={setTeam} teams={teams} />
      <ReminderFields idp={`ed-${s.id}`} value={rem} set={setRem} />
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <div className="btn-row">
        <button type="button" className="btn secondary" disabled={action.busy || !name.trim() || (audience === 'equipa' && !team)}
          onClick={() => action.run(() => call('cal_source_update', {
            p_section: section, p_source: s.id, p_data: { name, audience, team_id: audience === 'equipa' ? team : null, reminder_minutes: rem },
          }), 'Alterações guardadas.')}>
          Guardar
        </button>
      </div>
    </div>
  );
}

function AddSource({ teams, first }: { teams: Team[]; first: boolean }) {
  const section = useActiveSection().membership.section_id;
  const check = useAction();
  const save = useAction();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<IcloudPreview | null>(null);
  const [name, setName] = useState('');
  const [space, setSpace] = useState<'real' | 'teste'>('real');
  const [audience, setAudience] = useState<'seccao' | 'equipa'>('seccao');
  const [team, setTeam] = useState('');
  const [rem, setRem] = useState<number[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const reset = () => { setUrl(''); setPreview(null); setName(''); setSpace('real'); setAudience('seccao'); setTeam(''); setRem([]); };

  const verify = async () => {
    setDone(null);
    setPreview(null);
    const r = await check.run(() => icloudRequest<{ preview: IcloudPreview }>({ action: 'preview', section_id: section, url }));
    if (r.ok && r.value) { setPreview(r.value.preview); setName(r.value.preview.name ?? ''); }
  };
  const confirm = async () => {
    const r = await save.run(() => icloudRequest<{ id: string; stats: SyncStats }>({
      action: 'create', section_id: section, url, name, space, audience, team_id: audience === 'equipa' ? team : null, reminder_minutes: rem,
    }));
    if (r.ok) {
      setDone(`Ligado. ${r.value?.stats.criadas ?? 0} atividades importadas.`);
      reset();
    }
  };

  const body = (
    <>
      {done && <Notice kind="success">{done}</Notice>}
      <form onSubmit={(e) => { e.preventDefault(); void verify(); }} noValidate>
        <Field label="Link do calendário" htmlFor="ic-url" hint="No iCloud: Calendário › partilhar › Calendário público › copiar link (webcal://…).">
          <input id="ic-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="webcal://…" aria-describedby="ic-url-hint"
            value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} />
        </Field>
        <ErrorBox error={check.error} />
        <div className="btn-row"><button type="submit" className="btn secondary" disabled={check.busy || !url.trim()}>{check.busy ? 'A verificar…' : 'Verificar link'}</button></div>
      </form>
      {preview && (
        <>
          <div className="icloud-preview" aria-label="Pré-visualização">
            <dl className="icloud-facts">
              <dt>Calendário</dt><dd><strong>{preview.name ?? 'Sem nome'}</strong></dd>
              <dt>Atividades</dt><dd>{preview.events}{preview.cancelled > 0 && ` (+${preview.cancelled} canceladas)`}</dd>
              <dt>Datas</dt><dd>{range(preview.first, preview.last)}</dd>
            </dl>
            {preview.sample.length > 0 && (
              <>
                <span className="faint">Próximas:</span>
                <ul>{preview.sample.slice(0, 3).map((x, i) => <li key={i}>{x.all_day ? formatDay(x.day) : formatLisbon(x.starts_at!)} · {x.title}</li>)}</ul>
              </>
            )}
            {!preview.complete && <Notice kind="warn">Leitura incompleta: {preview.warnings.join(' ')}</Notice>}
          </div>
          <Field label="Nome na app" htmlFor="ic-name"><input id="ic-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <fieldset className="cal-fieldset">
            <legend className="label">Onde aparecem</legend>
            <div className="radio-row">
              <label className="radio"><input type="radio" name="ic-space" checked={space === 'real'} onChange={() => setSpace('real')} /> Dados reais</label>
              <label className="radio"><input type="radio" name="ic-space" checked={space === 'teste'} onChange={() => setSpace('teste')} /> Espaço de teste</label>
            </div>
          </fieldset>
          <AudienceFields idp="ic" audience={audience} setAudience={setAudience} team={team} setTeam={setTeam} teams={teams} />
          <ReminderFields idp="ic" value={rem} set={setRem} />
          <p className="faint">A importação não envia notificações. Nada é escrito no iCloud.</p>
          <ErrorBox error={save.error} />
          <div className="btn-row">
            <button type="button" className="btn" disabled={save.busy || !name.trim() || (audience === 'equipa' && !team)} onClick={() => void confirm()}>
              {save.busy ? 'A importar…' : 'Confirmar e importar'}
            </button>
            <button type="button" className="btn ghost" onClick={reset}>Cancelar</button>
          </div>
        </>
      )}
    </>
  );
  return (
    <section className="card" aria-labelledby="ic-add-h">
      <h2 id="ic-add-h">Ligar um calendário do iCloud</h2>
      {first ? body : <MoreOptions label="Ligar outro calendário" open={!!preview || !!done}>{body}</MoreOptions>}
    </section>
  );
}
