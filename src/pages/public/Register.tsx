import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { ErrorBox, Field, Notice } from '../../components/ui';
import PublicShell from './PublicShell';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Indica o teu nome.');
    if (password.length < 8) return setError('A palavra-passe deve ter pelo menos 8 caracteres.');
    if (password !== password2) return setError('As palavras-passe não coincidem.');
    setBusy(true);
    try {
      // Só o nome é enviado nos metadados; funções e permissões nunca são escolhidas no registo.
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/entrar?confirmado=1` },
      });
      if (error) throw error;
      if (!data.session) setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <PublicShell title="Confirma o teu email">
        <h1>Confirma o teu email</h1>
        <Notice kind="success">
          <p>Enviámos uma mensagem para <strong>{email}</strong>. Abre o link para confirmar a conta e depois entra.</p>
        </Notice>
        <p className="faint">Não chegou? Verifica a pasta de spam ou tenta de novo daqui a uns minutos.</p>
        <Link to="/entrar" className="btn secondary block">Ir para Entrar</Link>
      </PublicShell>
    );

  return (
    <PublicShell title="Criar conta">
      <h1>Criar conta</h1>
      <p className="lead">Cada pessoa tem a sua conta. Depois de entrar, usa o convite da tua secção para pedir acesso.</p>
      <ErrorBox error={error} />
      <form onSubmit={submit}>
        <Field label="Nome" htmlFor="name">
          <input id="name" type="text" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="email" hint="Usa o teu email pessoal: é por aqui que recuperas o acesso.">
          <input id="email" type="email" autoComplete="email" required aria-describedby="email-hint" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Palavra-passe" htmlFor="password" hint="Pelo menos 8 caracteres.">
          <input id="password" type="password" autoComplete="new-password" required minLength={8} aria-describedby="password-hint" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Repetir palavra-passe" htmlFor="password2">
          <input id="password2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
        </Field>
        <button className="btn block" disabled={busy}>{busy ? 'A criar…' : 'Criar conta'}</button>
      </form>
      <div className="btn-row">
        <Link to="/entrar" className="btn ghost">Já tenho conta</Link>
      </div>
    </PublicShell>
  );
}
