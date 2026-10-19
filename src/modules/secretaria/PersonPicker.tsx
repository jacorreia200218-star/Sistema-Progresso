// Seletor pesquisável de uma pessoa da secção (guarda o id do utilizador, nunca texto livre).
import { SearchSelect } from '../../components/SearchSelect';
import { functionLabel } from '../../lib/labels';
import type { MemberFunction } from '../../lib/types';
import { usePeople } from './api';

export function PersonPicker({ id, value, onChange, invalid }: { id: string; value: string; onChange: (id: string) => void; invalid?: boolean }) {
  const people = usePeople();
  const options = (people.data ?? []).map((p) => ({
    id: p.id, label: p.name,
    detail: [p.function && functionLabel[p.function as MemberFunction], p.team_name].filter(Boolean).join(' · ') || undefined,
  }));
  return (
    <SearchSelect id={id} value={value} onChange={onChange} options={options} invalid={invalid} loading={people.isLoading}
      placeholder="Procurar pelo nome" listLabel="Pessoas da secção" none="Ninguém com esse nome." minSearch={0} />
  );
}
