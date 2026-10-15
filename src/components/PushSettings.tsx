// Notificações no telemóvel (push): ativar neste dispositivo e enviar um teste.
import { useEffect, useState } from 'react';
import { Bell, BellOff, Send } from 'lucide-react';
import { useAction } from '../lib/useAction';
import { disablePush, enablePush, pushState, sendTestNotification, type PushState } from '../lib/push';
import { ErrorBox, Notice } from './ui';

const TEXT: Record<PushState, string> = {
  instalar: 'No iPhone, as notificações só funcionam com a app no ecrã principal. No Safari, toca em Partilhar e depois em «Adicionar ao ecrã principal». Abre a app a partir do novo ícone e volta aqui.',
  indisponivel: 'Este navegador não permite notificações. Experimenta com a app instalada no ecrã principal ou noutro navegador.',
  bloqueadas: 'As notificações estão bloqueadas para esta app. Ativa-as nas definições do telemóvel (Notificações › Pioneiros) e volta aqui.',
  desativadas: 'Recebe um aviso no telemóvel quando há um pedido novo, uma decisão ou um trilho a rever.',
  ativas: 'Ativas neste dispositivo. As notificações continuam também no sino da app.',
};

export function PushSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const action = useAction();
  const refresh = () => pushState().then(setState).catch(() => setState('indisponivel'));
  useEffect(() => { refresh(); }, []);

  return (
    <section className="card push-settings" aria-labelledby="h-push">
      <h2 id="h-push">Notificações no telemóvel</h2>
      {state && <p className="faint prose">{TEXT[state]}</p>}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
      <div className="btn-row">
        {state === 'desativadas' && (
          <button type="button" className="btn" disabled={action.busy}
            onClick={async () => { await action.run(enablePush, 'Notificações ativadas neste dispositivo.'); refresh(); }}>
            <Bell size={18} aria-hidden="true" /> Ativar notificações
          </button>
        )}
        {state === 'ativas' && (
          <>
            <button type="button" className="btn secondary" disabled={action.busy}
              onClick={() => action.run(sendTestNotification, 'Notificação de teste enviada. Deve chegar dentro de alguns segundos.')}>
              <Send size={18} aria-hidden="true" /> Enviar notificação de teste
            </button>
            <button type="button" className="btn ghost" disabled={action.busy}
              onClick={async () => { await action.run(disablePush, 'Notificações desativadas neste dispositivo.'); refresh(); }}>
              <BellOff size={18} aria-hidden="true" /> Desativar
            </button>
          </>
        )}
      </div>
    </section>
  );
}
