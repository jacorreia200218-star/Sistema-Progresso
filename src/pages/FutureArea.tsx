// Página de apresentação de uma área em desenvolvimento: nome, descrição curta e
// funcionalidades previstas. Sem formulários, números nem botões de ação.
import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { futureAreaByPath } from '../lib/futuras';
import { PageTitle } from '../components/ui';
import NotFound from './NotFound';

export default function FutureArea() {
  const { pathname } = useLocation();
  const area = futureAreaByPath.get(pathname.replace(/\/$/, ''));
  if (!area) return <NotFound />;
  const Icon = area.icon;
  return (
    <div className="future-area">
      <div className="future-head">
        <span className="future-icon" aria-hidden="true"><Icon size={28} /></span>
        <span className="badge tone-muted future-badge"><Construction size={15} aria-hidden="true" /> Em desenvolvimento</span>
      </div>
      <PageTitle title={area.name} subtitle={area.description} />

      <section className="card" aria-labelledby="h-previsto">
        <h2 id="h-previsto">Funcionalidades previstas</h2>
        <ul className="future-list">
          {area.features.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </section>

      {area.access && (
        <section className="card" aria-labelledby="h-acesso">
          <h2 id="h-acesso">Acesso e privacidade</h2>
          <ul className="future-list">
            {area.access.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
      )}

      <p className="faint prose">Esta área ainda não está disponível. Por agora, a página apenas apresenta o que está previsto e não guarda nem mostra dados.</p>
    </div>
  );
}
