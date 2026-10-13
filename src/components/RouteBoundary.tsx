// Carregamento e falhas das páginas, sem nunca deixar o ecrã vazio.
// Causa do ecrã em branco observado: as páginas são carregadas à parte (lazy) e,
// depois de uma nova publicação, os ficheiros antigos deixam de existir; o erro
// de importação subia até à raiz e o React desmontava a aplicação inteira.
import { Component, lazy, type ComponentType, type ReactNode } from 'react';

const RELOAD_KEY = 'pioneiros.recarregado';

function isChunkError(e: unknown) {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading dynamically/i.test(msg);
}

/** lazy() que, se o código da página falhar (nova versão publicada), recarrega uma vez. */
export function lazyPage<T extends ComponentType<object>>(importer: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await importer();
      try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignorar */ }
      return mod;
    } catch (e) {
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0); } catch { /* ignorar */ }
      if (isChunkError(e) && Date.now() - last > 15_000) {
        try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignorar */ }
        window.location.reload();
        return new Promise<never>(() => undefined); // a página vai recarregar
      }
      throw e;
    }
  });
}

/** Mensagem curta com «Tentar novamente» quando uma página falha; o resto da app mantém-se. */
export class RouteBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: unknown) {
    console.error('Falha ao mostrar a página:', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const chunk = isChunkError(this.state.error);
    return (
      <div className="alert error" role="alert">
        <div>
          <p style={{ margin: 0 }}>
            {chunk ? 'Não foi possível abrir esta página. Pode haver uma versão nova da aplicação ou a ligação falhou.' : 'Ocorreu um erro ao mostrar esta página.'}
          </p>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => (chunk ? window.location.reload() : this.setState({ error: null }))}>Tentar novamente</button>
          </div>
        </div>
      </div>
    );
  }
}
