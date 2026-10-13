import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { storeInviteCode } from '../../lib/invite';
import { Notice } from '../../components/ui';
import PublicShell from './PublicShell';

export default function InviteLanding() {
  const { session } = useAuth();
  const [stored, setStored] = useState(false);
  useEffect(() => {
    const code = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
    if (code) storeInviteCode(code);
    // Remove o código da barra de endereço.
    window.history.replaceState(null, '', '/convite');
    setStored(true);
  }, []);
  if (!stored) return null;
  if (session) return <Navigate to="/" replace />;
  return (
    <PublicShell title="Convite">
      <h1>Foste convidado para a secção</h1>
      <Notice kind="info">
        <p>
          O convite não substitui a tua conta: cria a tua conta individual (ou entra, se já tiveres) e o pedido de entrada fica a
          aguardar confirmação da administração.
        </p>
      </Notice>
      <div className="btn-row">
        <Link to="/registo" className="btn block">Criar conta</Link>
        <Link to="/entrar" className="btn secondary block">Já tenho conta</Link>
      </div>
    </PublicShell>
  );
}
