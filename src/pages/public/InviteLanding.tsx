import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { formatInviteCode, normalizeInviteCode, storeInviteCode } from '../../lib/invite';
import { Notice } from '../../components/ui';
import PublicShell from './PublicShell';

export default function InviteLanding() {
  const { session } = useAuth();
  const params = useParams();
  // Ligação curta /c#AB7K-9M2P (ou /c/AB7K9M2P); /convite#… dos convites antigos.
  // Lido uma só vez (o efeito pode correr duas vezes em desenvolvimento).
  const [initial] = useState(() => {
    const raw = decodeURIComponent(params.code ?? window.location.hash.replace(/^#/, '')).trim();
    return raw ? normalizeInviteCode(raw) : '';
  });
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    if (initial) storeInviteCode(initial);
    // Remove o código da barra de endereço.
    window.history.replaceState(null, '', '/convite');
    setStored(initial);
  }, [initial]);
  if (stored === null) return null;
  if (session) return <Navigate to="/" replace />;
  return (
    <PublicShell title="Convite">
      <h1>Foste convidado para a secção</h1>
      {stored && <p>Código do convite: <strong className="invite-code">{formatInviteCode(stored)}</strong></p>}
      <Notice kind="info">
        <p className="prose">
          Cria a tua conta individual (ou entra, se já tiveres). Antes de confirmares, vês a secção e a equipa de destino; depois o
          pedido fica a aguardar a confirmação da administração.
        </p>
      </Notice>
      <div className="btn-row">
        <Link to="/registo" className="btn block">Criar conta</Link>
        <Link to="/entrar" className="btn secondary block">Já tenho conta</Link>
      </div>
    </PublicShell>
  );
}
