import { Link } from 'react-router-dom';
import { Empty, PageTitle } from '../components/ui';

export default function NotFound() {
  return (
    <>
      <PageTitle title="Página não encontrada" back="/" />
      <Empty title="Não encontrámos o que procuras.">
        <p className="prose">Pode não existir ou não teres permissão para a ver.</p>
        <Link to="/" className="btn secondary">Ir para o Início</Link>
      </Empty>
    </>
  );
}
