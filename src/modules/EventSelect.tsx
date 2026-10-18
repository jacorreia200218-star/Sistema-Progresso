// Seletor de atividades do calendário, igual em todos os módulos: «DD/MM/AAAA · Nome», com a
// hora ou a equipa quando há outra atividade com o mesmo nome no mesmo dia, mais recentes
// primeiro e pesquisa quando a lista é longa. Guarda sempre o id do evento.
import { SearchSelect, type SearchOption } from '../components/SearchSelect';
import { formatDay } from './common';

export interface EventChoice {
  id: string;
  title: string;
  /** Dia em Lisboa, «AAAA-MM-DD». */
  day: string | null;
  /** Hora de início em Lisboa, «HH:MM» (sem hora nos eventos de dia inteiro). */
  time?: string | null;
  team_name?: string | null;
  cancelled?: boolean;
  /** Texto extra discreto (ex.: «já tem ata»). */
  note?: string | null;
  disabled?: boolean;
}

export function eventChoiceLabel(e: EventChoice, all: EventChoice[] = []): string {
  const twin = all.some((o) => o.id !== e.id && o.day === e.day && o.title.trim().toLowerCase() === e.title.trim().toLowerCase());
  const extra = twin ? [e.time, e.team_name].filter(Boolean).join(' · ') : '';
  return `${e.day ? formatDay(e.day) : 'Sem data'} · ${e.title}${extra ? ` · ${extra}` : ''}`;
}

export function eventOptions(events: EventChoice[]): SearchOption[] {
  return [...events]
    .sort((a, b) => (b.day ?? '').localeCompare(a.day ?? '') || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'pt'))
    .map((e) => ({
      id: e.id,
      label: eventChoiceLabel(e, events),
      detail: [e.cancelled ? 'cancelada' : null, e.note].filter(Boolean).join(' · ') || undefined,
      disabled: e.disabled,
    }));
}

export function EventSelect({ id, value, onChange, events, empty, placeholder = 'Procurar atividade', invalid, loading }: {
  id: string; value: string; onChange: (id: string) => void; events: EventChoice[];
  empty?: string; placeholder?: string; invalid?: boolean; loading?: boolean;
}) {
  return (
    <SearchSelect id={id} value={value} onChange={onChange} options={eventOptions(events)} empty={empty} placeholder={placeholder}
      invalid={invalid} loading={loading} listLabel="Atividades" none="Nenhuma atividade com esse nome ou data." />
  );
}
