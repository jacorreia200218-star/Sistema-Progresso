// Partilhar um convite: copiar o código, copiar a ligação curta e mostrar o QR.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, QrCode } from 'lucide-react';
import { formatInviteCode, inviteLink } from '../lib/invite';

export function InviteShare({ code }: { code: string }) {
  const [copied, setCopied] = useState<'codigo' | 'ligacao' | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const link = inviteLink(code);
  useEffect(() => {
    if (!showQr || qr) return;
    QRCode.toDataURL(link, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(null));
  }, [showQr, qr, link]);
  const copy = (text: string, what: 'codigo' | 'ligacao') =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      window.setTimeout(() => setCopied(null), 1800);
    });
  return (
    <div className="invite-share">
      <span className="invite-code" aria-label={`Código ${formatInviteCode(code).split('').join(' ')}`}>{formatInviteCode(code)}</span>
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button type="button" className="btn secondary" onClick={() => copy(formatInviteCode(code), 'codigo')}>
          <Copy size={16} aria-hidden="true" /> {copied === 'codigo' ? 'Código copiado' : 'Copiar código'}
        </button>
        <button type="button" className="btn secondary" onClick={() => copy(link, 'ligacao')}>
          <Copy size={16} aria-hidden="true" /> {copied === 'ligacao' ? 'Ligação copiada' : 'Copiar ligação'}
        </button>
        <button type="button" className="btn ghost" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
          <QrCode size={16} aria-hidden="true" /> {showQr ? 'Esconder QR' : 'Mostrar QR'}
        </button>
      </div>
      <span role="status" className="sr-only">{copied === 'codigo' ? 'Código copiado' : copied === 'ligacao' ? 'Ligação copiada' : ''}</span>
      {showQr && (qr ? <img className="invite-qr" src={qr} alt={`Código QR com a ligação ${link}`} width={220} height={220} /> : <p className="faint">A preparar o QR…</p>)}
    </div>
  );
}
