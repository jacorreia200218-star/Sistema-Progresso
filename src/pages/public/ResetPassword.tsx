import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { useAuth } from '../../auth/AuthProvider';
import { ErrorBox, Field, Loading, Notice, PasswordInput } from '../../components/ui';
import PublicShell from './PublicShell';

export default function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('A palavra-passe deve ter pelo menos 8 caracteres.');
    if (password !== password2) return setError('As palavras-passe não coincidem.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  return (
    <PublicShell title="Nova palavra-passe">
      <h1>Nova palavra-passe</h1>
      {done ? (
        <Notice kind="success">Palavra-passe alterada.</Notice>
      ) : !session ? (
        <>
          <Notice kind="warn">
            <p className="prose">O link expirou ou já foi usado. Pede um novo link de recuperação.</p>
          </Notice>
          <Link to="/recuperar" className="btn block">Pedir novo link</Link>
        </>
      ) : (
        <>
          <ErrorBox error={error} />
          <form onSubmit={submit}>
            <Field label="Nova palavra-passe" htmlFor="password" hint="Pelo menos 8 caracteres.">
              <PasswordInput id="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="Repetir palavra-passe" htmlFor="password2">
              <PasswordInput id="password2" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </Field>
            <button className="btn block" disabled={busy}>{busy ? 'A guardar…' : 'Guardar palavra-passe'}</button>
          </form>
        </>
      )}
    </PublicShell>
  );
}
