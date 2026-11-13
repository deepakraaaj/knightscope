import type { Evaluation } from '@/types';
import { winPercentWhite } from '@/chess/positions/evaluation';
import { formatEval } from '@/utils/format';
import { cx } from '@/components/ui';

export function EvalBar({ evaluation, orientation = 'white', horizontal }: { evaluation: Evaluation | null; orientation?: 'white' | 'black'; horizontal?: boolean }) {
  const white = evaluation ? winPercentWhite(evaluation) : 50;
  const label = formatEval(evaluation);
  const whiteOnBottom = orientation === 'white';
  if (horizontal) {
    return (
      <div className="relative h-5 w-full overflow-hidden rounded bg-[#1b2232]" aria-label={`Evaluation ${label}`} role="img">
        <div className="absolute inset-y-0 left-0 bg-[#e8ecf4] transition-[width] duration-300" style={{ width: `${white}%` }} />
        <span className={cx('absolute top-1/2 -translate-y-1/2 px-1.5 text-[10px] font-semibold tabular', white >= 50 ? 'left-0 text-[#0b1020]' : 'right-0 text-[#f5f7fb]')}>{label}</span>
      </div>
    );
  }
  return (
    <div className="relative w-6 shrink-0 overflow-hidden rounded bg-[#1b2232]" aria-label={`Evaluation ${label}`} role="img">
      <div className={cx('absolute inset-x-0 bg-[#e8ecf4] transition-[height] duration-300', whiteOnBottom ? 'bottom-0' : 'top-0')} style={{ height: `${white}%` }} />
      <span className={cx('absolute inset-x-0 text-center text-[9px] font-semibold tabular', (white >= 50) === whiteOnBottom ? 'bottom-1 text-[#0b1020]' : 'top-1 text-[#f5f7fb]')}>{label}</span>
    </div>
  );
}
