// Origem das atividades importadas (iCloud): etiqueta discreta nas listas e aviso no
// detalhe. Título, datas, local e descrição destas atividades só mudam no iCloud.
import { Cloud } from 'lucide-react';
import { formatLisbon } from '../common';
import './icloud.css';

export interface CalSource {
  id: string;
  kind: 'icloud';
  name: string;
  /** Estado na origem: ok, cancelado, removido (deixou de vir no ICS) ou arquivado (ligação desligada). */
  state: 'ok' | 'cancelado' | 'removido' | 'arquivado';
  removed_at: string | null;
  synced_at: string | null;
  source_status: 'ativa' | 'parada' | 'arquivada';
  /** Fonte ativa: os dados da origem não se alteram na app. */
  readonly: boolean;
}

type WithSource = { source?: CalSource | null };

export const isImported = (e: WithSource) => !!e.source;
export const isReadonly = (e: WithSource) => !!e.source?.readonly;

const STATE_LABEL: Record<CalSource['state'], string | null> = {
  ok: null, cancelado: 'cancelada no iCloud', removido: 'removida no iCloud', arquivado: 'ligação arquivada',
};

/** «iCloud» discreto (com o estado na origem, quando não está normal). */
export function SourceTag({ source }: { source?: CalSource | null }) {
  if (!source) return null;
  const extra = STATE_LABEL[source.state];
  return (
    <span className={`cal-src${extra ? ' is-off' : ''}`} title={`Vem do calendário «${source.name}» do iCloud`}>
      <Cloud size={12} aria-hidden="true" />
      <span>iCloud{extra ? ` · ${extra}` : ''}</span>
    </span>
  );
}

/** Aviso curto no detalhe de uma atividade importada. */
export function SourceNotice({ e }: { e: WithSource }) {
  const s = e.source;
  if (!s) return null;
  return (
    <p className="cal-src-note" role="note">
      <Cloud size={15} aria-hidden="true" />
      <span>
        Do iCloud («{s.name}»).{' '}
        {s.state === 'removido' ? <>Removida no iCloud{s.removed_at && <> a {formatLisbon(s.removed_at)}</>}; os registos ligados mantêm-se.</>
          : s.state === 'cancelado' ? 'Cancelada no iCloud; os registos ligados mantêm-se.'
          : s.state === 'arquivado' ? 'Ligação ao iCloud arquivada.'
          : s.readonly ? 'Título, datas, local e descrição alteram-se no iCloud.'
          : 'Atualizações paradas: pode ser alterada aqui.'}
        {s.synced_at && <span className="faint"> Sincronizada a {formatLisbon(s.synced_at)}.</span>}
      </span>
    </p>
  );
}
