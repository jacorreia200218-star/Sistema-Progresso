import { useState } from 'react';
import type { Catalog, CatalogArea, CatalogTrail } from '../lib/types';
import { Field } from './ui';

/**
 * Escolha de um trilho em dois passos: primeiro a área (FACEIS), depois o
 * trilho dentro dela. `value` é o id ou a chave do trilho (conforme `by`).
 */
export function TrailPicker({
  catalog, value, onChange, id, by = 'id', areas, available = () => true, describe, optional, trailLabel = 'Trilho',
}: {
  catalog: Catalog;
  value: string;
  onChange: (v: string) => void;
  id: string;
  by?: 'id' | 'key';
  areas?: CatalogArea[];
  available?: (t: CatalogTrail) => boolean;
  describe?: (t: CatalogTrail) => string;
  optional?: boolean;
  trailLabel?: string;
}) {
  const list = (areas ?? catalog.areas).filter((a) => a.catalog_trails.some(available));
  const current = value ? (by === 'id' ? catalog.trailById.get(value) : catalog.trailByKey.get(value)) : undefined;
  const [areaId, setAreaId] = useState(current?.area_id ?? '');
  const area = list.find((a) => a.id === (current?.area_id ?? areaId));
  const trails = area ? area.catalog_trails.filter(available) : [];
  return (
    <div className="grid-2 trail-picker">
      <Field label={optional ? 'Área (opcional)' : 'Área'} htmlFor={`${id}-area`}>
        <select id={`${id}-area`} value={area?.id ?? ''} onChange={(e) => { setAreaId(e.target.value); onChange(''); }}>
          <option value="">{optional ? '—' : 'Escolhe a área…'}</option>
          {list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
      </Field>
      <Field label={trailLabel} htmlFor={id}>
        <select id={id} value={value} disabled={!area} onChange={(e) => onChange(e.target.value)}>
          <option value="">{area ? 'Escolhe o trilho…' : 'Primeiro a área'}</option>
          {trails.map((t) => (
            <option key={t.id} value={by === 'id' ? t.id : t.key}>{t.name}{describe ? ` (${describe(t)})` : ''}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}
