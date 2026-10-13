import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { ErrorBox, Field, Notice, PasswordInput } from '../../components/ui';
import PublicShell from './PublicShell';

export default function Login() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell title="Entrar">
      <h1>Entrar</h1>
      {params.get('confirmado') && <Notice kind="success">Email confirmado. Já podes entrar.</Notice>}
      <ErrorBox error={error} />
      <form onSubmit={submit} noValidate={false}>
        <Field label="Email" htmlFor="email">
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Palavra-passe" htmlFor="password">
          <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn block" disabled={busy}>{busy ? 'A entrar…' : 'Entrar'}</button>
      </form>
      <div className="btn-row">
        <Link to="/recuperar" className="btn ghost">Esqueci-me da palavra-passe</Link>
        <Link to="/registo" className="btn ghost">Criar conta</Link>
      </div>
    </PublicShell>
  );
}
