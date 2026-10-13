// Tema Claro / Escuro / Sistema. «Sistema» segue a preferência do dispositivo.
// A escolha fica guardada neste dispositivo; o script em index.html aplica-a
// antes do primeiro desenho da página.
import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'pioneiros.tema';

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
  window.dispatchEvent(new CustomEvent('pioneiros:tema', { detail: choice }));
}

/** Tema efetivamente em uso (resolve «Sistema»). */
export function effectiveTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  useEffect(() => {
    const on = (e: Event) => setChoice((e as CustomEvent<ThemeChoice>).detail);
    window.addEventListener('pioneiros:tema', on);
    return () => window.removeEventListener('pioneiros:tema', on);
  }, []);
  return [choice, (t) => applyTheme(t)];
}
