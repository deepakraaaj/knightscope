import { useMemo, useState, type CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/storage/database/db';

export interface BoardArrow {
  from: string;
  to: string;
  color?: string;
}

export interface BoardProps {
  id: string;
  fen: string;
  orientation?: 'white' | 'black';
  /** Called with a UCI move when the user makes a legal move. Return false to reject it. */
  onMove?: (uci: string) => boolean | void;
  arrows?: BoardArrow[];
  lastMove?: string | null;
  highlight?: Record<string, string>;
  interactive?: boolean;
  className?: string;
}

const THEMES = {
  slate: { light: '#d3dbe8', dark: '#6f86ab' },
  classic: { light: '#f0d9b5', dark: '#b58863' },
};

export function Board({ id, fen, orientation = 'white', onMove, arrows = [], lastMove, highlight, interactive = false, className }: BoardProps) {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const theme = THEMES[settings?.boardTheme ?? 'slate'];
  const showCoords = settings?.showCoordinates ?? true;
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const targets = useMemo(() => (selected ? chess.moves({ square: selected, verbose: true }).map((m) => m.to) : []), [chess, selected]);

  const tryMove = (from: Square, to: Square, promo?: string): boolean => {
    if (!interactive || !onMove) return false;
    const legal = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (legal.length === 0) return false;
    if (legal.some((m) => m.promotion) && !promo) {
      setPromotion({ from, to });
      return false;
    }
    const uci = from + to + (promo ?? '');
    const ok = onMove(uci);
    setSelected(null);
    return ok !== false;
  };

  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove && lastMove.length >= 4) {
    squareStyles[lastMove.slice(0, 2)] = { background: 'rgba(124,156,255,0.32)' };
    squareStyles[lastMove.slice(2, 4)] = { background: 'rgba(124,156,255,0.42)' };
  }
  for (const [sq, color] of Object.entries(highlight ?? {})) squareStyles[sq] = { background: color };
  if (selected) squareStyles[selected] = { background: 'rgba(250,204,21,0.45)' };
  for (const t of targets) {
    squareStyles[t] = {
      ...(squareStyles[t] ?? {}),
      backgroundImage: chess.get(t as Square) ? 'radial-gradient(circle, transparent 58%, rgba(11,16,32,0.45) 60%)' : 'radial-gradient(circle, rgba(11,16,32,0.4) 22%, transparent 24%)',
    };
  }
  if (chess.inCheck()) {
    const k = chess.findPiece({ type: 'k', color: chess.turn() })[0];
    if (k) squareStyles[k] = { ...(squareStyles[k] ?? {}), background: 'radial-gradient(circle, rgba(248,113,113,0.85) 0%, rgba(248,113,113,0.25) 70%)' };
  }

  return (
    <div className={`relative aspect-square w-full select-none overflow-hidden rounded-lg ${className ?? ''}`} data-testid={`board-${id}`} data-fen={fen}>
      <Chessboard
        options={{
          id,
          position: fen,
          boardOrientation: orientation,
          allowDragging: interactive,
          showNotation: showCoords,
          animationDurationInMs: 160,
          arrows: arrows.map((a) => ({ startSquare: a.from, endSquare: a.to, color: a.color ?? 'rgba(124,156,255,0.85)' })),
          allowDrawingArrows: true,
          clearArrowsOnPositionChange: true,
          lightSquareStyle: { backgroundColor: theme.light },
          darkSquareStyle: { backgroundColor: theme.dark },
          squareStyles,
          canDragPiece: ({ piece }) => interactive && piece.pieceType[0] === chess.turn(),
          onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare ? tryMove(sourceSquare as Square, targetSquare as Square) : false),
          onSquareClick: ({ square, piece }) => {
            if (!interactive) return;
            const sq = square as Square;
            if (selected && targets.includes(sq)) {
              tryMove(selected, sq);
              return;
            }
            if (piece && piece.pieceType[0] === chess.turn()) setSelected(sq === selected ? null : sq);
            else setSelected(null);
          },
        }}
      />
      {promotion && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55" role="dialog" aria-label="Choose promotion piece">
          <div className="flex gap-2 rounded-xl border border-border bg-surface p-3">
            {(['q', 'r', 'b', 'n'] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  const pr = promotion;
                  setPromotion(null);
                  tryMove(pr.from, pr.to, p);
                }}
                className="flex size-12 items-center justify-center rounded-lg bg-elevated text-2xl hover:bg-primary hover:text-on-primary"
                aria-label={{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p]}
              >
                {chess.turn() === 'w' ? { q: '♕', r: '♖', b: '♗', n: '♘' }[p] : { q: '♛', r: '♜', b: '♝', n: '♞' }[p]}
              </button>
            ))}
            <button onClick={() => setPromotion(null)} className="px-2 text-sm text-muted hover:text-text">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
