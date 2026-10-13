import { Link } from 'react-router-dom';
import { Compass, Leaf, Route as RouteIcon } from 'lucide-react';
import PublicShell from './PublicShell';
import rosaUrl from '../../assets/rosa-dos-ventos.svg';

export default function Landing() {
  return (
    <PublicShell title="Bem-vindo">
      <section className="hero">
        <img src={rosaUrl} alt="Rosa dos Ventos, símbolo da III Secção" className="hero-mark" />
        <h1>O teu caminho na III Secção</h1>
        <p className="lead">
          Um espaço para acompanhar o progresso pessoal dos Pioneiros: escolher trilhos, registar vivências, pedir a validação e
          ver o caminho percorrido — com a tua Equipa e a Equipa de Animação.
        </p>
        <div className="btn-row">
          <Link to="/entrar" className="btn block">Entrar</Link>
          <Link to="/registo" className="btn secondary block">Criar conta</Link>
        </div>
      </section>
      <ul className="list card flat">
        <li className="list-item"><Compass aria-hidden="true" /> <span>Seis áreas de desenvolvimento e dezoito trilhos.</span></li>
        <li className="list-item"><RouteIcon aria-hidden="true" /> <span>Etapas do Conhecimento, Vontade e Construção.</span></li>
        <li className="list-item"><Leaf aria-hidden="true" /> <span>Crescimento pessoal, sem pontos nem classificações.</span></li>
      </ul>
      <p className="faint">
        O acesso aos dados exige conta individual e entrada confirmada na secção. Esta é uma ferramenta de acompanhamento local:
        não substitui os registos oficiais do CNE.
      </p>
    </PublicShell>
  );
}
