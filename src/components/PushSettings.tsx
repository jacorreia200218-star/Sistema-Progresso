// Notificações neste dispositivo (push): estado, instruções para o tipo de dispositivo
// (computador, Android, iPhone), ativar, enviar um teste e desativar.
// Não se promete a entrega com o ecrã bloqueado: depende do sistema e só um teste real o confirma.
import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, RefreshCw, Send } from 'lucide-react';
import { useAction } from '../lib/useAction';
import { disablePush, enablePush, pushDeviceStatus, pushState, sendTestNotification, type PushDevice, type PushInfo, type PushState } from '../lib/push';
import { formatDateTime, type Tone } from '../lib/labels';
import { Badge, ErrorBox, Loading, Notice } from './ui';

const STATE: Record<PushState, { label: string; tone: Tone; icon: string }> = {
  indisponivel: { label: 'Indisponível', tone: 'muted', icon: 'x' },
  por_autorizar: { label: 'Por autorizar', tone: 'attention', icon: 'clock' },
  bloqueado: { label: 'Bloqueado', tone: 'attention', icon: 'x' },
  ativo: { label: 'Ativo', tone: 'ok', icon: 'check' },
};

const DEVICE: Record<PushDevice, string> = { iphone: 'iPhone ou iPad', android: 'Android', computador: 'Computador' };

/** Passos curtos para cada caso (sem parágrafos longos). */
function steps(info: PushInfo): string[] {
  const { device, state } = info;
  if (state === 'indisponivel' && info.reason === 'instalar')
    return [
      'Abre esta página no Safari.',
      'Toca em Partilhar e escolhe «Adicionar ao ecrã principal».',
      'Abre a app pelo novo ícone e volta ao Perfil.',
    ];
  if (state === 'indisponivel')
    return device === 'iphone' ? ['Atualiza o iPhone para o iOS 16.4 ou mais recente.']
      : device === 'android' ? ['Usa o Chrome ou instala a app (menu ⋮ › «Instalar app»).']
        : ['Usa uma versão recente do Chrome, Edge, Firefox ou Safari.'];
  if (state === 'bloqueado')
    return device === 'iphone' ? ['Abre Definições › Notificações › Pioneiros.', 'Ativa «Permitir notificações» e volta aqui.']
      : device === 'android' ? ['Toca no cadeado ao lado do endereço (ou em Definições › Apps, se instalaste a app).', 'Permite as notificações e volta aqui.']
        : ['Clica no cadeado ao lado do endereço.', 'Permite as notificações para este site e recarrega a página.'];
  if (state === 'por_autorizar')
    return info.granted ? ['Desativadas neste dispositivo. Toca em «Ativar notificações» para voltar a receber.']
      : ['Toca em «Ativar notificações».', `Aceita o pedido ${device === 'computador' ? 'do navegador' : 'do telemóvel'}.`];
  return [];
}

export function PushSettings() {
  const [info, setInfo] = useState<PushInfo | null>(null);
  const [device, setDevice] = useState<{ last_sent_at: string | null; last_error: string | null } | null>(null);
  const action = useAction();
  const refresh = useCallback(() => {
    pushState().then((st) => {
      setInfo(st);
      if (st.state === 'ativo') pushDeviceStatus().then(setDevice).catch(() => setDevice(null));
      else setDevice(null);
    }).catch(() => setInfo((old) => old ?? { device: 'computador', state: 'indisponivel', standalone: false, reason: 'navegador' }));
  }, []);
  useEffect(() => {
    refresh();
    // Ao voltar das definições do dispositivo, o estado pode ter mudado.
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const list = info ? steps(info) : [];
  return (
    <section className="card push-settings" aria-labelledby="h-push">
      <h2 id="h-push">Notificações neste dispositivo</h2>
      {!info ? <Loading compact label="A verificar as notificações…" /> : (
        <>
          <dl className="meta push-meta">
            <dt>Dispositivo</dt>
            <dd>{DEVICE[info.device]}{info.device !== 'computador' && info.standalone ? ' · app no ecrã principal' : ''}</dd>
            <dt>Estado</dt>
            <dd><Badge {...STATE[info.state]} /></dd>
          </dl>
          <p className="faint prose">
            {info.state === 'ativo' ? 'Recebes aqui avisos de pedidos novos, decisões e trilhos a rever. Ficam também no sino da app.'
              : info.state === 'indisponivel' && info.reason === 'instalar' ? 'No iPhone e no iPad, os avisos só funcionam com a app no ecrã principal.'
                : info.state === 'indisponivel' ? 'Este navegador não permite avisos. As notificações continuam no sino da app.'
                  : info.state === 'bloqueado' ? 'Os avisos estão bloqueados para esta app. As notificações continuam no sino da app.'
                    : 'Podes receber aqui avisos de pedidos novos, decisões e trilhos a rever.'}
          </p>
          {list.length > 1 ? (
            <ol className="push-steps">{list.map((t) => <li key={t}>{t}</li>)}</ol>
          ) : list.length === 1 ? <p className="faint prose">{list[0]}</p> : null}
          {info.state === 'ativo' && (
            <p className="faint prose push-device">
              {device?.last_error
                ? `O último envio para este dispositivo falhou (${device.last_error}). Desativa e volta a ativar as notificações.`
                : device?.last_sent_at
                  ? `Último aviso aceite pelo serviço de notificações: ${formatDateTime(device.last_sent_at)}.`
                  : 'Ainda não foi enviado nenhum aviso para este dispositivo.'}
              {' '}{info.device === 'computador'
                ? 'Só aparecem enquanto o navegador estiver a funcionar, mesmo em segundo plano.'
                : 'Com o ecrã bloqueado, depende da poupança de bateria e do modo Foco: confirma com um teste.'}
            </p>
          )}
        </>
      )}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      {info && (
        <div className="btn-row">
          {info.state === 'por_autorizar' && (
            <button type="button" className="btn" disabled={action.busy}
              onClick={async () => { await action.run(enablePush, 'Notificações ativadas neste dispositivo.'); refresh(); }}>
              <Bell size={18} aria-hidden="true" /> Ativar notificações
            </button>
          )}
          {info.state === 'bloqueado' && (
            <button type="button" className="btn secondary" disabled={action.busy} onClick={refresh}>
              <RefreshCw size={18} aria-hidden="true" /> Verificar de novo
            </button>
          )}
          {info.state === 'ativo' && (
            <>
              <button type="button" className="btn secondary" disabled={action.busy}
                onClick={async () => { await action.run(sendTestNotification, 'Teste enviado ao serviço de notificações. Se não aparecer, revê as definições do dispositivo.'); setTimeout(refresh, 4000); }}>
                <Send size={18} aria-hidden="true" /> Enviar notificação de teste
              </button>
              <button type="button" className="btn ghost" disabled={action.busy}
                onClick={async () => { await action.run(disablePush, 'Notificações desativadas neste dispositivo.'); refresh(); }}>
                <BellOff size={18} aria-hidden="true" /> Desativar
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
