// Vibração muito curta ao tocar em botões principais e na barra de baixo (só telemóveis
// que a suportam, como Android; no iPhone o navegador ignora). Respeita «menos movimento».
const TARGETS = '.btn:not(.secondary):not(.ghost):not(:disabled), .bottom-nav .nav-link, .tab, .segment';

export function installHaptics() {
  if (typeof window === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (!window.matchMedia?.('(pointer: coarse)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest(TARGETS) : null;
      if (el) {
        try { navigator.vibrate(8); } catch { /* sem vibração */ }
      }
    },
    { passive: true, capture: true },
  );
}
