import { useEffect, type ReactNode } from 'react';
import { Brand } from '../../components/Layout';

export default function PublicShell({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Pioneiros`;
  }, [title]);
  return (
    <div className="public">
      <div style={{ marginBottom: 24 }}>
        <Brand />
      </div>
      <main id="conteudo">{children}</main>
    </div>
  );
}
