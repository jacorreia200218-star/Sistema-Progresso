// Campos de data e de data e hora sempre em DD/MM/AAAA e 24 horas, seja qual for o idioma
// do navegador (o <input type="date"> nativo mostra «mm/dd/yyyy» em navegadores em inglês).
// O valor continua a ser «AAAA-MM-DD» (ou «AAAA-MM-DDTHH:MM»), como no campo nativo, e o
// botão do calendário abre o seletor do sistema. onChange recebe { target: { value } } para
// se usar exatamente como um <input>.
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { CalendarDays } from 'lucide-react';
import { formatDate, maskDateText, parseDateText, parseTimeText } from '../lib/dates';

type ValueEvent = { target: { value: string } };
type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'defaultValue'>;

export interface DateInputProps extends Base {
  value: string;
  onChange: (e: ValueEvent) => void;
  min?: string;
  max?: string;
  /** Uso interno do DateTimeInput: valor completo «AAAA-MM-DDTHH:MM» escrito ou colado no campo da data. */
  onDateTime?: (day: string, time: string) => void;
}

const show = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDate(iso) : '');

/** Abre o seletor nativo (quando o navegador o permite). */
function openPicker(el: HTMLInputElement | null) {
  if (!el) return;
  try {
    (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    el.focus();
  }
}

export function DateInput({ value, onChange, min, max, className, disabled, id, onDateTime, ...rest }: DateInputProps) {
  const [text, setText] = useState(() => show(value));
  const emitted = useRef(value);
  const native = useRef<HTMLInputElement>(null);
  // Valor mudado de fora (ex.: «Limpar», dia escolhido no calendário): mostra-o.
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(show(value));
    }
  }, [value]);
  const emit = (v: string) => {
    if (v === emitted.current) return;
    emitted.current = v;
    onChange({ target: { value: v } });
  };
  const write = (raw: string) => {
    const full = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw.trim());
    if (full && onDateTime) {
      emitted.current = full[1];
      setText(show(full[1]));
      onDateTime(full[1], full[2]);
      return;
    }
    const t = maskDateText(raw);
    setText(t);
    emit(t.trim() === '' ? '' : parseDateText(t) ?? '');
  };
  return (
    <span className={`date-input${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}>
      <input {...rest} id={id} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa"
        value={text} disabled={disabled} onChange={(e) => write(e.target.value)}
        onBlur={(e) => {
          const iso = parseDateText(text);
          if (iso) setText(formatDate(iso));
          rest.onBlur?.(e);
        }} />
      <span className="date-input-btn" aria-hidden="true">
        <CalendarDays size={18} />
        <input ref={native} type="date" tabIndex={-1} value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''} min={min} max={max}
          disabled={disabled} onClick={(e) => openPicker(e.currentTarget)}
          onChange={(e) => { setText(show(e.target.value)); emit(e.target.value); }} />
      </span>
    </span>
  );
}

export interface DateTimeInputProps extends Omit<DateInputProps, 'min' | 'max' | 'onDateTime'> {
  min?: string;
  max?: string;
  /** Nome do campo da hora para leitores de ecrã (ex.: «Hora de início»). */
  timeLabel?: string;
}

/** Data e hora: «AAAA-MM-DDTHH:MM» (como o datetime-local). Também aceita colar o valor completo no campo da data. */
export function DateTimeInput({ value, onChange, min, max, id, disabled, timeLabel = 'Hora', ...rest }: DateTimeInputProps) {
  const [day, setDay] = useState(value.slice(0, 10));
  const [time, setTime] = useState(value.slice(11, 16));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setDay(value.slice(0, 10));
      setTime(value.slice(11, 16));
    }
  }, [value]);
  const emit = (d: string, t: string) => {
    const tt = parseTimeText(t);
    const v = d && tt ? `${d}T${tt}` : '';
    if (v === emitted.current) return;
    emitted.current = v;
    onChange({ target: { value: v } });
  };
  return (
    <span className="datetime-input">
      <DateInput {...rest} id={id} disabled={disabled} value={day} min={min?.slice(0, 10)} max={max?.slice(0, 10)}
        onChange={(e) => { setDay(e.target.value); emit(e.target.value, time); }}
        onDateTime={(d, t) => { setDay(d); setTime(t); emit(d, t); }} />
      <input type="text" inputMode="numeric" autoComplete="off" placeholder="hh:mm" maxLength={5} className="time-input"
        aria-label={timeLabel} id={id ? `${id}-hora` : undefined} disabled={disabled}
        value={time}
        onChange={(e) => {
          let t = e.target.value.replace(/[^\d:h]/gi, '');
          if (/^\d{3,4}$/.test(t)) t = `${t.slice(0, t.length - 2)}:${t.slice(-2)}`;
          setTime(t);
          emit(day, t);
        }}
        onBlur={() => { const t = parseTimeText(time); if (t) setTime(t); }} />
    </span>
  );
}
