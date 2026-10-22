// «Mais» (telemóvel): os destinos que não cabem na barra de baixo, por ordem alfabética,
// e a Gestão no fim.
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { PageTitle } from '../components/ui';
import { useNavItems } from '../components/Layout';

export default function More() {
  const { overflow } = useNavItems();
  const groups = [overflow.filter((i) => i.key !== 'gestao'), overflow.filter((i) => i.key === 'gestao')].filter((g) => g.length);
  return (
    <>
      <PageTitle title="Mais" />
      {groups.map((g, n) => (
        <nav key={n} className="card more-list" aria-label={n === 0 ? 'Outras secções' : 'Gestão'}>
          <ul className="list">
            {g.map((i) => (
              <li key={i.key}>
                <Link to={i.to} className="list-item">
                  <i.icon size={20} aria-hidden="true" />
                  <span className="grow">{i.label}</span>
                  {i.tag && <span className={`badge ${i.tag === 'Em teste' ? 'tone-progress' : 'tone-muted'}`}>{i.tag}</span>}
                  {!!i.count && <span className="nav-count-inline">{i.count}<span className="sr-only"> {i.countLabel}</span></span>}
                  <ChevronRight size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}
    </>
  );
}
