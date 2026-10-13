import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeChoice } from '../lib/theme';

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

/** Escolha de tema (grupo de opções acessível). */
export function ThemeControl() {
  const [choice, setChoice] = useTheme();
  return (
    <fieldset>
      <legend>Tema</legend>
      <div className="segmented" role="radiogroup" aria-label="Tema">
        {OPTIONS.map((o) => (
          <label key={o.value} className="segment">
            <input type="radio" name="tema" value={o.value} checked={choice === o.value} onChange={() => setChoice(o.value)} />
            <o.icon size={18} aria-hidden="true" />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <p className="faint" style={{ marginTop: 6 }}>«Sistema» segue a preferência do dispositivo. A escolha fica guardada neste dispositivo.</p>
    </fieldset>
  );
}

/** Botão compacto para a barra superior: alterna Claro → Escuro → Sistema. */
export function ThemeToggle() {
  const [choice, setChoice] = useTheme();
  const next: ThemeChoice = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light';
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;
  const label = OPTIONS.find((o) => o.value === choice)!.label;
  return (
    <button type="button" className="btn ghost icon-btn" onClick={() => setChoice(next)}
      aria-label={`Tema: ${label}. Mudar para ${OPTIONS.find((o) => o.value === next)!.label}`} title={`Tema: ${label}`}>
      <Icon size={20} aria-hidden="true" />
    </button>
  );
}
