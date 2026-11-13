import { useEffect } from 'react';

/** Arrow-key navigation through a game (ignored while typing in inputs). */
export function useKeyboardNav(handlers: { prev: () => void; next: () => void; first: () => void; last: () => void; flip?: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'ArrowLeft') handlers.prev();
      else if (e.key === 'ArrowRight') handlers.next();
      else if (e.key === 'Home' || e.key === 'ArrowUp') handlers.first();
      else if (e.key === 'End' || e.key === 'ArrowDown') handlers.last();
      else if (e.key === 'f' && handlers.flip) handlers.flip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
}
