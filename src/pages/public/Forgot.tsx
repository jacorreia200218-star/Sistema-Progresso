import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/errors';
import { ErrorBox, Field, Notice } from '../../components/ui';
import PublicShell from './PublicShell';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/nova-palavra-passe`,
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell title="Recuperar acesso">
      <h1>Recuperar acesso</h1>
      {sent ? (
        <Notice kind="success">
          <p className="prose">Se existir uma conta com este email, vais receber um link para definir uma nova palavra-passe.</p>
        </Notice>
      ) : (
        <>
          <ErrorBox error={error} />
          <form onSubmit={submit}>
            <Field label="Email da conta" htmlFor="email">
              <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <button className="btn block" disabled={busy}>{busy ? 'A enviar…' : 'Enviar link'}</button>
          </form>
        </>
      )}
      <div className="btn-row">
        <Link to="/entrar" className="btn ghost">Voltar a Entrar</Link>
      </div>
    </PublicShell>
  );
}
