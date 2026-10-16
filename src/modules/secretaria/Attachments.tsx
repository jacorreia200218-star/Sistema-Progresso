// Anexos de uma reunião ou de um documento (base comum dos módulos). O servidor decide
// quem lê (quem vê a reunião) e quem anexa ou retira (quem redige). Anexar escolhe-se no
// menu «Mais» da página (abre o seletor de ficheiros); a secção só aparece quando há anexos.
import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { ErrorBox, Notice } from '../../components/ui';
import { useAction } from '../../lib/useAction';
import { listModuleFiles, openModuleFile, removeModuleFile, uploadModuleFile } from '../files';
import { formatLisbon } from '../common';
import { useSectionId } from './api';

/** Abre o seletor de ficheiros dos anexos desta entidade (usado no menu «Mais»). */
export const pickAttachment = (entityId: string) => document.getElementById(`file-${entityId}`)?.click();

export function Attachments({ entity, entityId, canWrite }: { entity: 'sec_meeting' | 'sec_minute'; entityId: string; canWrite: boolean }) {
  const section = useSectionId();
  const files = useQuery({ queryKey: ['sec-files', entity, entityId], queryFn: () => listModuleFiles(section, 'secretaria', entity, entityId) });
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const list = files.data ?? [];
  const show = list.length > 0 || !!files.error || !!action.error || !!action.success || action.busy;
  return (
    <>
      {canWrite && (
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" id={`file-${entityId}`}
          tabIndex={-1} aria-label="Anexar ficheiro (JPG, PNG, WebP ou PDF, até 10 MB)"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) action.run(() => uploadModuleFile(section, 'secretaria', entity, entityId, f), 'Anexo carregado.');
          }} />
      )}
      {show && (
        <section className="card" aria-labelledby={`anexos-${entityId}`}>
          <h2 className="sec-h2" id={`anexos-${entityId}`}>Anexos</h2>
          <ErrorBox error={files.error} />
          {list.length > 0 && (
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
          )}
          {action.busy && <p className="faint sec-meta">A carregar…</p>}
          <ErrorBox error={action.error} />
          {action.success && <Notice kind="success">{action.success}</Notice>}
          {canWrite && <p className="faint sec-meta">JPG, PNG, WebP ou PDF, até 10 MB. Visível para quem vê esta reunião.</p>}
        </section>
      )}
    </>
  );
}
