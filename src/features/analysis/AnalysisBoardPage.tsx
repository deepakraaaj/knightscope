import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chess, validateFen } from 'chess.js';
import { ArrowLeftRight, Cpu, FileInput, ListOrdered, Microscope, RotateCcw, Undo2 } from 'lucide-react';
import { Board } from '@/components/chess/Board';
import { EvalBar } from '@/components/chess/EvalBar';
import { Button, Card, IconButton, Notice, PageHeader, Segmented, Spinner, cx } from '@/components/ui';
import { useLiveAnalysis } from '@/hooks/useEngine';
import { applyUci, isTerminal, lineToSan } from '@/chess/positions/board';
import { formatEval } from '@/utils/format';

const START = new Chess().fen();

export function AnalysisBoardPage() {
  const [params] = useSearchParams();
  const initial = useMemo(() => {
    const f = params.get('fen');
    return f && validateFen(f).ok ? f : START;
  }, [params]);
  const [startFen, setStartFen] = useState(initial);
  const [moves, setMoves] = useState<string[]>([]);
  const [flip, setFlip] = useState(initial.split(' ')[1] === 'b');
  const [engineOn, setEngineOn] = useState(true);
  const [lines, setLines] = useState<'1' | '2' | '3'>('3');
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  const fen = useMemo(() => {
    const c = new Chess(startFen);
    for (const m of moves) {
      const r = applyUci(c.fen(), m);
      if (!r) break;
      c.load(r.chess.fen());
    }
    return c.fen();
  }, [startFen, moves]);
  const sans = useMemo(() => lineToSan(startFen, moves), [startFen, moves]);
  const live = useLiveAnalysis(fen, engineOn, 22, Number(lines));
  const terminal = isTerminal(fen);

  const loadFen = () => {
    const f = fenInput.trim();
    const v = validateFen(f);
    if (!v.ok) {
      setFenError(v.error ?? 'Invalid FEN.');
      return;
    }
    setFenError(null);
    setStartFen(f);
    setMoves([]);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={Microscope} steps={['Move pieces on the board', 'Read the engine lines on the right', 'Click a line to play its first move']} title="Analysis board" description="Explore positions from finished games or study positions with Stockfish running on this device." />
      <Notice kind="info">Use the analysis board only for completed games and study positions. Using engine help during a game you are playing is cheating on every chess site.</Notice>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="mx-auto flex w-full max-w-[680px] gap-2">
          {engineOn && <div className="hidden sm:flex"><EvalBar evaluation={live.eval} orientation={flip ? 'black' : 'white'} /></div>}
          <div className="min-w-0 flex-1 space-y-2">
            <Board
              id="analysis"
              fen={fen}
              orientation={flip ? 'black' : 'white'}
              interactive
              onMove={(uci) => {
                setMoves((m) => [...m, uci]);
                return true;
              }}
              lastMove={moves[moves.length - 1] ?? null}
              arrows={engineOn && live.lines[0]?.moves[0] ? [{ from: live.lines[0].moves[0].slice(0, 2), to: live.lines[0].moves[0].slice(2, 4) }] : []}
            />
            {engineOn && <div className="sm:hidden"><EvalBar evaluation={live.eval} horizontal /></div>}
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-1">
              <div className="flex">
                <IconButton label="Undo move" onClick={() => setMoves((m) => m.slice(0, -1))} disabled={moves.length === 0}><Undo2 className="size-4" /></IconButton>
                <IconButton label="Reset to start position" onClick={() => { setStartFen(START); setMoves([]); }}><RotateCcw className="size-4" /></IconButton>
                <IconButton label="Flip board" onClick={() => setFlip((f) => !f)}><ArrowLeftRight className="size-4" /></IconButton>
              </div>
              <span className="pr-2 text-xs text-muted">{fen.split(' ')[1] === 'w' ? 'White' : 'Black'} to move</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card icon={Cpu} piece="queen" title="Engine" hint="Best continuations; + favours White, − favours Black" action={<Segmented label="Engine" value={engineOn ? 'on' : 'off'} onChange={(v) => setEngineOn(v === 'on')} options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />}>
            {!engineOn ? (
              <p className="text-sm text-muted">Engine is off.</p>
            ) : terminal.over ? (
              <p className="text-sm text-muted">{terminal.checkmate ? 'Checkmate.' : 'The game is over in this position (draw).'}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{live.engineName ?? 'Starting engine…'}</span>
                  <span className="tabular">{live.running ? <Spinner label={`depth ${live.depth}`} /> : `depth ${live.depth}`}</span>
                </div>
                <Segmented label="Lines" value={lines} onChange={setLines} options={[{ value: '1', label: '1 line' }, { value: '2', label: '2 lines' }, { value: '3', label: '3 lines' }]} />
                {live.error && <Notice kind="error">{live.error}</Notice>}
                <ol className="flex flex-col gap-2" data-testid="engine-lines">
                  {live.lines.map((l) => (
                    <li key={l.multipv} className="flex gap-2 text-sm">
                      <span className={cx('w-14 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-semibold tabular', (l.eval.kind === 'cp' ? l.eval.value >= 0 : l.eval.value > 0) ? 'bg-[#e8ecf4] text-[#0b1020]' : 'bg-[#1b2232] text-[#f5f7fb]')}>{formatEval(l.eval)}</span>
                      <button className="min-w-0 text-left text-muted hover:text-text" onClick={() => setMoves((m) => [...m, l.moves[0]])} title="Play the first move of this line">
                        {lineToSan(fen, l.moves.slice(0, 10)).join(' ')}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Card>
          <Card icon={ListOrdered} title="Moves" hint="Moves you have played on this board">
            {sans.length === 0 ? <p className="text-sm text-muted">Make a move on the board.</p> : <p className="text-sm leading-relaxed">{sans.map((s, i) => <span key={i} className="mr-1.5">{s}</span>)}</p>}
          </Card>
          <Card icon={FileInput} title="Load position" hint="Paste a FEN to set up any position">
            <div className="flex flex-col gap-2">
              <input className="input font-mono text-xs" placeholder="Paste a FEN" value={fenInput} onChange={(e) => setFenInput(e.target.value)} spellCheck={false} />
              {fenError && <p className="text-xs text-bad">{fenError}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={loadFen} disabled={!fenInput.trim()}>Load FEN</Button>
                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(fen)}>Copy current FEN</Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
