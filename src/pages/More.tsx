// «Mais» (telemóvel): destinos que não cabem na barra de baixo e as áreas em desenvolvimento.
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { FUTURE_AREAS } from '../lib/futuras';
import { PageTitle } from '../components/ui';
import { useNavItems } from '../components/Layout';
import { moduleTag, useMyModules } from '../modules/common';

export default function More() {
  const { overflow } = useNavItems();
  const modules = useMyModules();
  return (
    <>
      <PageTitle title="Mais" />
      {overflow.length > 0 && (
        <nav className="card more-list" aria-label="Outras secções">
          <ul className="list">
            {overflow.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="list-item">
                  <i.icon size={20} aria-hidden="true" />
                  <span className="grow">{i.label}</span>
                  {!!i.count && <span className="nav-count-inline">{i.count}<span className="sr-only"> {i.countLabel}</span></span>}
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <h2 className="section-title">Módulos</h2>
      <nav className="card more-list" aria-label="Módulos">
        <ul className="list">
          {FUTURE_AREAS.map((a) => {
            const tag = moduleTag(modules.data?.find((m) => m.module === a.key));
            return (
              <li key={a.key}>
                <Link to={a.to} className="list-item">
                  <a.icon size={20} aria-hidden="true" />
                  <span className="grow">{a.name}</span>
                  {tag && <span className={`badge ${tag === 'Em teste' ? 'tone-progress' : 'tone-muted'}`}>{tag}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
