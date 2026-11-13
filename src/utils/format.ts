import type { Evaluation } from '@/types';

export function formatEval(e: Evaluation | null | undefined): string {
  if (!e) return '–';
  if (e.kind === 'mate') {
    if (e.value === 0) return e.matedSide === 'w' ? '0-1' : '1-0';
    return `${e.value > 0 ? '' : '-'}M${Math.abs(e.value)}`;
  }
  const v = e.value / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function pct(n: number | null | undefined, digits = 1): string {
  return n == null || Number.isNaN(n) ? '–' : `${n.toFixed(digits)}%`;
}

export function moveNumberLabel(ply: number): string {
  const n = Math.floor(ply / 2) + 1;
  return ply % 2 === 0 ? `${n}.` : `${n}...`;
}
