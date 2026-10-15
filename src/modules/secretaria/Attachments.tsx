// Anexos de uma reunião ou de um documento (base comum dos módulos). O servidor decide
// quem lê (quem vê a reunião) e quem anexa ou retira (quem redige).
import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Paperclip } from 'lucide-react';
import { ErrorBox, Notice } from '../../components/ui';
import { useAction } from '../../lib/useAction';
import { listModuleFiles, openModuleFile, removeModuleFile, uploadModuleFile } from '../files';
import { formatLisbon } from '../common';
import { useSectionId } from './api';

export function Attachments({ entity, entityId, canWrite }: { entity: 'sec_meeting' | 'sec_minute'; entityId: string; canWrite: boolean }) {
  const section = useSectionId();
  const files = useQuery({ queryKey: ['sec-files', entity, entityId], queryFn: () => listModuleFiles(section, 'secretaria', entity, entityId) });
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const list = files.data ?? [];
  if (!canWrite && list.length === 0 && !files.error) return null;
  return (
    <section className="card" aria-labelledby={`anexos-${entityId}`}>
      <h2 className="sec-h2" id={`anexos-${entityId}`}>Anexos</h2>
      <ErrorBox error={files.error} />
      {list.length === 0 && <p className="faint">Sem anexos.</p>}
      <ul className="list">
        {list.map((f) => (
          <li key={f.path} className="list-item">
            <FileText size={18} aria-hidden="true" />
            <button type="button" className="link-btn grow ellipsis sec-file" onClick={() => action.run(() => openModuleFile(f.path))}>{f.file_name}</button>
            <span className="faint sec-meta nowrap">{formatLisbon(f.created_at)}</span>
            {canWrite && (
              <button type="button" className="btn ghost sec-small" disabled={action.busy}
                onClick={() => action.run(() => removeModuleFile(f.path), 'Anexo retirado.')}>Retirar</button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" id={`file-${entityId}`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) action.run(() => uploadModuleFile(section, 'secretaria', entity, entityId, f), 'Anexo carregado.');
            }} />
          <div className="btn-row">
            <button type="button" className="btn secondary" disabled={action.busy} onClick={() => input.current?.click()}>
              <Paperclip size={16} aria-hidden="true" /> {action.busy ? 'A carregar…' : 'Anexar ficheiro'}
            </button>
          </div>
          <p className="faint sec-meta">JPG, PNG, WebP ou PDF, até 10 MB. Visível para quem vê esta reunião.</p>
        </>
      )}
      <ErrorBox error={action.error} />
      {action.success && <Notice kind="success">{action.success}</Notice>}
    </section>
  );
}
