// Gestão › Módulos: estado de cada módulo, testers e permissões. Só a
// administração vê este separador; o servidor recusa estas operações a quem não é.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useActiveSection } from '../lib/session';
import { useMembers } from '../lib/hooks';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { FUTURE_AREAS } from '../lib/futuras';
import { ConfirmButton, ErrorBox, Field, Loading, Notice } from '../components/ui';
import { MODULE_PERMISSIONS, MODULE_STATUS_LABEL, type ModuleKey, type ModuleStatus } from './common';

type Overview = { module: ModuleKey; status: ModuleStatus; testers: string[]; grants: { permission: string; profile_id: string }[] };
type RoleGrants = {
  roles: { id: string; name: string }[];
  links: { role_id: string; permission: string }[];
  holders: { permission: string; profile_id: string; full_name: string; role_name: string; team_name: string | null }[];
};
/** Permissões que um cargo de equipa pode dar (o servidor recusa as restantes). */
const ROLE_PERMISSIONS = ['tesouraria.gerir', 'inventario.gerir'];

export function AdminModules() {
  const s = useActiveSection();
  const section = s.membership.section_id;
  const q = useQuery({ queryKey: ['module-admin', section], queryFn: () => call<Overview[]>('module_admin_overview', { p_section: section }) });
  const members = useMembers(section);
  const rg = useQuery({ queryKey: ['module-role-grants', section], queryFn: () => call<RoleGrants>('module_role_grants_overview', { p_section: section }) });
  if (q.isLoading || members.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={() => q.refetch()} />;
  const active = (members.data ?? []).filter((m) => m.status === 'ativo');
  return (
    <>
      <p className="faint prose">
        Cada módulo começa «Em desenvolvimento». Em teste, só os testers escolhidos o usam, num espaço de teste separado dos dados reais.
        Ser tester não dá permissões de edição: essas atribuem-se à parte. Ao publicar, os dados reais começam vazios, salvo se escolheres passar os dados de teste.
        Voltar atrás nunca apaga dados.
      </p>
      {FUTURE_AREAS.map((a) => {
        const o = q.data?.find((x) => x.module === a.key);
        return o ? <ModuleCard key={a.key} name={a.name} o={o} rg={rg.data} members={active.map((m) => ({ id: m.profile_id, name: m.profiles?.full_name ?? '?' }))} section={section} /> : null;
      })}
    </>
  );
}

function ModuleCard({ name, o, rg, members, section }: { name: string; o: Overview; rg?: RoleGrants; members: { id: string; name: string }[]; section: string }) {
  const action = useAction();
  const [status, setStatus] = useState<ModuleStatus>(o.status);
  const [move, setMove] = useState(false);
  const [tester, setTester] = useState('');
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Membro inativo';
  const changed = status !== o.status;
  return (
    <section className="card module-admin" aria-labelledby={`mod-${o.module}`}>
      <h2 id={`mod-${o.module}`}>{name}</h2>
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}

      <fieldset className="radio-row">
        <legend className="label">Estado</legend>
        {(['desenvolvimento', 'teste', 'disponivel'] as ModuleStatus[]).map((st) => (
          <label key={st} className="radio">
            <input type="radio" name={`st-${o.module}`} checked={status === st} onChange={() => setStatus(st)} /> {MODULE_STATUS_LABEL[st]}
          </label>
        ))}
      </fieldset>
      {changed && status === 'disponivel' && o.module === 'equipas' && (
        <p className="faint">Em Equipas e cargos os dados de teste não passam a reais: as equipas e os membros já são os reais, e as nomeações e mudanças fazem-se de novo no espaço real.</p>
      )}
      {changed && status === 'disponivel' && o.module !== 'equipas' && (
        <label className="checkbox">
          <input type="checkbox" checked={move} onChange={(e) => setMove(e.target.checked)} /> Passar os dados de teste para reais (por omissão, os dados reais começam vazios)
        </label>
      )}
      {changed && (
        <ConfirmButton className="btn" confirmLabel="Confirmar" disabled={action.busy}
          description={status === 'disponivel' ? `«${name}» fica disponível para todos os membros ativos${move ? ', com os dados de teste passados para reais' : ', com os dados reais vazios'}.`
            : status === 'teste' ? `«${name}» fica disponível só para os testers, no espaço de teste.`
            : `«${name}» volta a «Em desenvolvimento». Os dados ficam guardados.`}
          onConfirm={() => action.run(() => call('set_module_status', { p_section: section, p_module: o.module, p_status: status, p_move_test_data: move }), 'Estado atualizado.')}>
          Guardar estado
        </ConfirmButton>
      )}

      <h3 className="label" style={{ marginTop: 18 }}>Testers</h3>
      {o.testers.length === 0 ? <p className="faint">Ainda sem testers.</p> : (
        <ul className="chip-list" aria-label={`Testers de ${name}`}>
          {o.testers.map((t) => (
            <li key={t} className="chip">
              {nameOf(t)}
              <button type="button" className="chip-x" aria-label={`Retirar ${nameOf(t)} dos testers`} disabled={action.busy}
                onClick={() => action.run(() => call('set_module_tester', { p_section: section, p_module: o.module, p_profile: t, p_on: false }), 'Tester retirado.')}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <Field label="Adicionar tester" htmlFor={`add-${o.module}`}>
          <select id={`add-${o.module}`} value={tester} onChange={(e) => setTester(e.target.value)}>
            <option value="">Escolhe um membro…</option>
            {members.filter((m) => !o.testers.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <button type="button" className="btn secondary" disabled={!tester || action.busy}
          onClick={async () => { const r = await action.run(() => call('set_module_tester', { p_section: section, p_module: o.module, p_profile: tester, p_on: true }), 'Tester adicionado.'); if (r.ok) setTester(''); }}>
          Adicionar
        </button>
      </div>

      {MODULE_PERMISSIONS[o.module].map((p) => (
        <div key={p.key}>
          <GrantRow p={p} o={o} members={members} section={section} action={action} />
          {rg && ROLE_PERMISSIONS.includes(p.key) && <RoleGrantRow p={p} rg={rg} section={section} action={action} />}
        </div>
      ))}
    </section>
  );
}

function GrantRow({ p, o, members, section, action }: {
  p: { key: string; label: string; hint: string }; o: Overview; members: { id: string; name: string }[]; section: string; action: ReturnType<typeof useAction>;
}) {
  const [who, setWho] = useState('');
  const holders = o.grants.filter((g) => g.permission === p.key).map((g) => g.profile_id);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? 'Membro inativo';
  return (
    <div className="grant-row">
      <h3 className="label" style={{ marginTop: 18 }}>{p.label}</h3>
      <p className="faint prose">{p.hint}</p>
      {holders.length > 0 && (
        <ul className="chip-list" aria-label={p.label}>
          {holders.map((h) => (
            <li key={h} className="chip">
              {nameOf(h)}
              <button type="button" className="chip-x" aria-label={`Retirar «${p.label}» a ${nameOf(h)}`} disabled={action.busy}
                onClick={() => action.run(() => call('set_module_grant', { p_section: section, p_permission: p.key, p_profile: h, p_on: false }), 'Permissão retirada.')}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <Field label={`Atribuir «${p.label}»`} htmlFor={`g-${p.key}`}>
          <select id={`g-${p.key}`} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Escolhe um membro…</option>
            {members.filter((m) => !holders.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <button type="button" className="btn secondary" disabled={!who || action.busy}
          onClick={async () => { const r = await action.run(() => call('set_module_grant', { p_section: section, p_permission: p.key, p_profile: who, p_on: true }), 'Permissão atribuída.'); if (r.ok) setWho(''); }}>
          Atribuir
        </button>
      </div>
    </div>
  );
}

/** Cargos de equipa que dão a permissão: quem está nomeado tem-na enquanto a nomeação durar. */
function RoleGrantRow({ p, rg, section, action }: {
  p: { key: string; label: string }; rg: RoleGrants; section: string; action: ReturnType<typeof useAction>;
}) {
  const linked = new Set(rg.links.filter((l) => l.permission === p.key).map((l) => l.role_id));
  const holders = rg.holders.filter((h) => h.permission === p.key);
  return (
    <div className="grant-row">
      <fieldset className="role-grants">
        <legend className="label">Cargos que dão «{p.label}»</legend>
        {rg.roles.length === 0 ? <p className="faint">Ainda não há cargos em Equipas e cargos.</p> : (
          <div className="role-grant-options">
            {rg.roles.map((r) => (
              <label key={r.id} className="checkbox">
                <input type="checkbox" checked={linked.has(r.id)} disabled={action.busy}
                  onChange={(e) => action.run(() => call('set_module_role_grant', { p_section: section, p_role: r.id, p_permission: p.key, p_on: e.target.checked }),
                    e.target.checked ? `«${r.name}» passa a dar «${p.label}».` : `«${r.name}» deixa de dar «${p.label}».`)} />
                {' '}{r.name}
              </label>
            ))}
          </div>
        )}
        <p className="faint prose">Quem está nomeado para um destes cargos tem a permissão enquanto a nomeação durar. Os dirigentes não a recebem por cargo.</p>
      </fieldset>
      {holders.length > 0 && (
        <ul className="chip-list" aria-label={`Com «${p.label}» por cargo`}>
          {holders.map((h) => (
            <li key={`${h.profile_id}-${h.role_name}`} className="chip chip-static">
              {h.full_name} <span className="faint">· {h.role_name}{h.team_name ? ` · ${h.team_name}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
