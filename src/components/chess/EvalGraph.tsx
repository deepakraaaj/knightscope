import { Area, AreaChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PositionAnalysis } from '@/types';
import { winPercentWhite } from '@/chess/positions/evaluation';
import { CLASSIFICATION_META } from '@/chess/classification/classify';
import { formatEval } from '@/utils/format';

/** White's estimated winning chance after each move. Click to jump to a move. */
export function EvalGraph({ positions, current, onSelect }: { positions: PositionAnalysis[]; current: number; onSelect: (pliesPlayed: number) => void }) {
  const data = [
    { x: 0, w: positions[0]?.evaluationBefore ? winPercentWhite(positions[0].evaluationBefore) : 50, label: 'Start', ev: positions[0]?.evaluationBefore ?? null },
    ...positions.map((p) => ({ x: p.ply + 1, w: p.evaluationAfter ? winPercentWhite(p.evaluationAfter) : 50, label: `${Math.floor(p.ply / 2) + 1}${p.ply % 2 ? '…' : '.'} ${p.actualSan}`, ev: p.evaluationAfter })),
  ];
  const marks = positions.filter((p) => p.classification === 'blunder' || p.classification === 'mistake' || p.classification === 'brilliant' || p.classification === 'great');
  return (
    <div className="h-28 w-full cursor-pointer" aria-label="Evaluation graph" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 6 }} onClick={(e) => {
          const idx = Number((e as { activeTooltipIndex?: number | string } | null)?.activeTooltipIndex);
          if (Number.isFinite(idx)) onSelect(data[idx].x);
        }}>
          <defs>
            <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E8ECF4" stopOpacity={0.9} />
              <stop offset="100%" stopColor="#E8ECF4" stopOpacity={0.7} />
            </linearGradient>
          </defs>
          <XAxis dataKey="x" hide type="number" domain={[0, data.length - 1]} />
          <YAxis domain={[0, 100]} hide />
          <ReferenceLine y={50} stroke="#29364A" />
          <Tooltip
            cursor={{ stroke: '#7C9CFF', strokeWidth: 1 }}
            contentStyle={{ background: '#1A2538', border: '1px solid #29364A', borderRadius: 8, fontSize: 12 }}
            labelFormatter={(_, p) => (p?.[0]?.payload as { label?: string })?.label ?? ''}
            formatter={(_v, _n, item) => [formatEval((item?.payload as { ev?: Parameters<typeof formatEval>[0] })?.ev), 'Eval']}
          />
          <Area type="monotone" dataKey="w" stroke="#C9D3E3" strokeWidth={1.2} fill="url(#evalFill)" baseValue={0} isAnimationActive={false} />
          <ReferenceLine x={current} stroke="#7C9CFF" strokeWidth={1.5} />
          {marks.map((p) => (
            <ReferenceDot key={p.ply} x={p.ply + 1} y={p.evaluationAfter ? winPercentWhite(p.evaluationAfter) : 50} r={3.5} fill={CLASSIFICATION_META[p.classification!].color} stroke="#0B1020" />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
