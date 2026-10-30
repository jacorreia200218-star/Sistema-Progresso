import { useEffect, useState, type FormEvent } from 'react';
import { Camera, KeyRound, LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/signOut';
import { useActiveSection } from '../lib/session';
import { useTeams } from '../lib/hooks';
import { call } from '../lib/api';
import { useAction } from '../lib/useAction';
import { squarePhoto } from '../lib/image';
import { errorMessage } from '../lib/errors';
import { functionLabel, memberStatusLabel } from '../lib/labels';
import { Avatar, ErrorBox, Field, Notice, PageTitle, PasswordInput } from '../components/ui';
import { ThemeControl } from '../components/ThemeControl';
import { PushSettings } from '../components/PushSettings';
import { useQueryClient } from '@tanstack/react-query';

export default function Profile() {
  const s = useActiveSection();
  const queryClient = useQueryClient();
  const teams = useTeams(s.membership.section_id);
  const action = useAction();
  const [name, setName] = useState(s.profile?.full_name ?? '');
  const [totem, setTotem] = useState(s.profile?.totem ?? '');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [pwd, setPwd] = useState('');
  const pwdAction = useAction();

  useEffect(() => {
    setName(s.profile?.full_name ?? '');
    setTotem(s.profile?.totem ?? '');
  }, [s.profile?.full_name, s.profile?.totem]);

  const team = teams.data?.find((t) => t.id === s.membership.team_id);

  async function save(e: FormEvent) {
    e.preventDefault();
    await action.run(() => call('update_my_profile', { p_full_name: name, p_totem: totem }), 'Perfil guardado.');
  }

  // O envio decorre em segundo plano; o resto da página continua utilizável.
  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const blob = await squarePhoto(file);
      const old = s.profile?.photo_path;
      const path = `${s.userId}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from('fotografias').upload(path, blob, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const res = await action.run(() => call('set_my_photo', { p_path: path }), 'Fotografia atualizada.');
      if (res.ok && old) await supabase.storage.from('fotografias').remove([old]);
    } catch (e) {
      setPhotoError(errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    const old = s.profile?.photo_path;
    const res = await action.run(() => call('set_my_photo', { p_path: null }), 'Fotografia removida.');
    if (res.ok && old) await supabase.storage.from('fotografias').remove([old]);
  }

  return (
    <>
      <PageTitle title="Perfil" />
      <div className="card row">
        <Avatar name={s.profile?.full_name ?? '?'} photoPath={s.profile?.photo_path} size="lg" />
        <div className="grow">
          <h2 style={{ margin: 0 }}>{s.profile?.full_name}</h2>
          {s.profile?.totem && <p className="muted" style={{ margin: 0 }}>{s.profile.totem}</p>}
          <p className="faint" style={{ margin: 0 }}>
            {s.membership.function ? functionLabel[s.membership.function] : 'Administração'}
            {team ? ` · ${team.name}` : ''}
            {s.membership.is_admin && s.membership.function ? ' · Administração' : ''}
          </p>
        </div>
      </div>

      <form className="card" onSubmit={save}>
        <h2>Dados</h2>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <Field label="Nome" htmlFor="name">
          <input id="name" type="text" required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Totem (opcional)" htmlFor="totem">
          <input id="totem" type="text" maxLength={120} value={totem} onChange={(e) => setTotem(e.target.value)} />
        </Field>
        <p className="faint prose">A equipa e a função são definidas pela administração da secção.</p>
        <button className="btn" disabled={action.busy}>Guardar</button>
      </form>

      <div className="card">
        <h2>Fotografia (opcional)</h2>
        <p className="faint prose">Fica privada: só é vista por quem acompanha o teu percurso e pela tua equipa. É comprimida antes do envio.</p>
        <ErrorBox error={photoError} />
        <div className="btn-row">
          <label className="btn secondary">
            <Camera size={18} aria-hidden="true" /> {photoBusy ? 'A enviar…' : 'Escolher fotografia'}
            <input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" disabled={photoBusy} onChange={(e) => onPhoto(e.target.files?.[0])} />
          </label>
          {s.profile?.photo_path && (
            <button type="button" className="btn ghost" onClick={removePhoto} disabled={action.busy}>Remover</button>
          )}
        </div>
      </div>

      <PushSettings />

      <div className="card">
        <h2>Aparência</h2>
        <ThemeControl />
      </div>

      {s.memberships.length > 1 && (
        <div className="card">
          <h2>Secções</h2>
          <ul className="list">
            {s.memberships.map((m) => (
              <li key={m.id} className="list-item">
                <span className="grow">{m.sections?.name} <span className="faint">· {memberStatusLabel[m.status]}</span></span>
                {m.status === 'ativo' && m.section_id !== s.membership.section_id && (
                  <button type="button" className="btn secondary" onClick={() => s.selectSection(m.section_id)}>Abrir</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form className="card" onSubmit={(e) => { e.preventDefault(); pwdAction.run(async () => {
        if (pwd.length < 8) throw new Error('A palavra-passe deve ter pelo menos 8 caracteres.');
        const { error } = await supabase.auth.updateUser({ password: pwd });
        if (error) throw new Error(errorMessage(error));
        setPwd('');
      }, 'Palavra-passe alterada.'); }}>
        <h2>Acesso</h2>
        <ErrorBox error={pwdAction.error} />
        {pwdAction.success && <Notice kind="success">{pwdAction.success}</Notice>}
        <Field label="Nova palavra-passe" htmlFor="pwd" hint="Pelo menos 8 caracteres. Se te esqueceres, usa «Esqueci-me da palavra-passe» no ecrã de entrada.">
          <PasswordInput id="pwd" autoComplete="new-password" minLength={8} value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </Field>
        <div className="btn-row">
          <button className="btn secondary" disabled={pwdAction.busy || pwd.length < 8}><KeyRound size={18} aria-hidden="true" /> Alterar palavra-passe</button>
          <button type="button" className="btn ghost" onClick={() => signOut(queryClient)}><LogOut size={18} aria-hidden="true" /> Sair</button>
        </div>
      </form>
      <p className="faint prose">Ferramenta de acompanhamento local. Não substitui os registos oficiais do CNE.</p>
    </>
  );
}
