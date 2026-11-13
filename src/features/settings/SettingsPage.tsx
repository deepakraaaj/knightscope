import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, Gauge, Upload } from 'lucide-react';
import { useSettings } from '@/hooks/data';
import { allUsernames, exportAll, importAll, refreshUserColors, saveSettings, DEFAULT_SETTINGS } from '@/storage/repositories';
import { DEFAULT_THRESHOLDS } from '@/chess/classification/classify';
import { BENCHMARK_DEPTH, BENCHMARK_FEN, PRESETS, recommendPreset } from '@/engine/scheduler/presets';
import { fullEngineAvailable, maxEnginesAllowed, getInteractiveEngine, terminateInteractiveEngine, enginePool } from '@/engine/stockfish/enginePool';
import { nativeEngineInfo } from '@/engine/native/nativeTransport';
import { Button, Card, Notice, PageHeader, Segmented, Select, toast } from '@/components/ui';
import { cleanText, cleanUsername } from '@/utils/sanitize';
import { backgroundAnalysis } from '@/engine/native/background';
import type { AppSettings, ClassificationThresholds, PresetName } from '@/types';

function NumberField({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" className="input h-9 py-0" value={value} min={min} max={max} step={step} onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }} />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

export function SettingsPage() {
  const s = useSettings();
  const [names, setNames] = useState({ chesscom: '', lichess: '', other: '' });
  const [fullAvail, setFullAvail] = useState<boolean | null>(null);
  const [native, setNative] = useState<{ available: boolean; engineName?: string; cores?: number } | null>(null);
  const [bench, setBench] = useState<'idle' | 'running'>('idle');
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNames({ chesscom: s.usernames.chesscom, lichess: s.usernames.lichess, other: s.usernames.other.join(', ') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.usernames.chesscom, s.usernames.lichess, s.usernames.other.join(',')]);
  useEffect(() => {
    fullEngineAvailable().then(setFullAvail);
    nativeEngineInfo().then(setNative);
    navigator.storage?.estimate?.().then((e) => setStorage({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => undefined);
  }, []);

  const save = async (patch: Partial<AppSettings>) => {
    await saveSettings(patch);
  };

  const saveNames = async () => {
    const usernames = { chesscom: cleanUsername(names.chesscom), lichess: cleanUsername(names.lichess), // PGN player names may contain spaces ("Paul Morphy"), so they are only stripped of unsafe characters.
    other: names.other.split(',').map((n) => cleanText(n, 60)).filter(Boolean).slice(0, 10) };
    const next = await saveSettings({ usernames });
    await refreshUserColors(allUsernames(next));
    toast.success('Usernames saved. Your games were re-matched to your color.');
  };

  const setFlavor = async (engineFlavor: AppSettings['engineFlavor']) => {
    await save({ engineFlavor });
    terminateInteractiveEngine();
    enginePool.terminateAll();
  };

  const runBenchmark = async () => {
    setBench('running');
    try {
      const e = await getInteractiveEngine(s.engineFlavor);
      await e.newGame();
      const t0 = performance.now();
      await e.analyze({ fen: BENCHMARK_FEN, depth: BENCHMARK_DEPTH });
      const ms = Math.round(performance.now() - t0);
      const recommended = recommendPreset(ms);
      await save({ benchmark: { ms, at: Date.now(), recommended, engine: e.name } });
      toast.success(`Benchmark finished in ${(ms / 1000).toFixed(1)} s. Recommended preset: ${recommended}.`);
    } catch (err) {
      toast.error(`Benchmark failed: ${(err as Error).message}`);
    } finally {
      setBench('idle');
    }
  };

  const doExport = async () => {
    try {
      const json = await exportAll();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `knightscope-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  };

  const doImport = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 200 * 1024 * 1024) return toast.error('Backup file is too large.');
    try {
      const counts = await importAll(await f.text());
      toast.success(`Backup restored: ${counts.games} games, ${counts.exercises} exercises, ${counts.attempts} attempts added. Existing records were kept.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const t = s.thresholds;
  const setT = (k: keyof ClassificationThresholds, v: number) => save({ thresholds: { ...t, [k]: v } });
  const maxEngines = maxEnginesAllowed();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Everything is stored on this device." />

      <Card title="Your accounts">
        <p className="mb-3 text-sm text-muted">Used to know which side you played, so reviews, mistake memory and analytics focus on your moves. No password is needed or stored.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1"><span className="label">Chess.com username</span><input className="input" value={names.chesscom} onChange={(e) => setNames({ ...names, chesscom: e.target.value })} autoCapitalize="off" spellCheck={false} /></label>
          <label className="flex flex-col gap-1"><span className="label">Lichess username</span><input className="input" value={names.lichess} onChange={(e) => setNames({ ...names, lichess: e.target.value })} autoCapitalize="off" spellCheck={false} /></label>
          <label className="flex flex-col gap-1"><span className="label">Other names in PGN files</span><input className="input" value={names.other} onChange={(e) => setNames({ ...names, other: e.target.value })} placeholder="comma separated" spellCheck={false} /></label>
        </div>
        <Button className="mt-3" variant="primary" onClick={saveNames}>Save usernames</Button>
      </Card>

      <Card title="Analysis engine">
        <div className="flex flex-col gap-5">
          <div>
            <div className="label mb-2">Engine</div>
            <Segmented
              label="Engine"
              value={s.engineFlavor}
              onChange={setFlavor}
              options={[
                { value: 'lite', label: 'Stockfish 19 lite (WASM)' },
                ...(fullAvail ? [{ value: 'full' as const, label: 'Stockfish 19 full (WASM)' }] : []),
                ...(native?.available ? [{ value: 'native' as const, label: 'Stockfish native' }] : []),
              ]}
            />
            <p className="mt-2 text-xs text-muted">
              The lite engine (about 1.7 MB) runs everywhere. {fullAvail === false && 'The stronger full engine (about 94 MB) is not installed on this deployment; self-hosters can add it with “npm run engine:full”. '}
              {native?.available ? `Native Stockfish is available on this device (${native.cores ?? '?'} cores) and is much faster.` : Capacitor.isNativePlatform() ? 'Native engine not available in this build.' : ''}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Select label="Default preset" value={s.preset} onChange={(v: PresetName) => save({ preset: v })} options={(Object.keys(PRESETS) as PresetName[]).map((k) => ({ value: k, label: `${k[0].toUpperCase() + k.slice(1)} (depth ${PRESETS[k].screeningDepth} / ${PRESETS[k].deepDepth})` }))} />
            <Select label="Parallel engines" value={String(Math.min(s.maxEngines, maxEngines))} onChange={(v) => save({ maxEngines: Number(v) })} options={Array.from({ length: maxEngines }, (_, i) => ({ value: String(i + 1), label: `${i + 1}${i === 0 ? ' (recommended)' : ''}` }))} />
            <div className="flex flex-col gap-1">
              <span className="label">Custom depths</span>
              <Segmented label="Custom depth" value={s.customDepth ? 'custom' : 'preset'} onChange={(v) => save({ customDepth: v === 'custom' ? { screening: PRESETS[s.preset].screeningDepth, deep: PRESETS[s.preset].deepDepth } : null })} options={[{ value: 'preset', label: 'Use preset' }, { value: 'custom', label: 'Custom' }]} />
            </div>
          </div>
          {s.customDepth && (
            <div className="grid gap-4 sm:grid-cols-3">
              <NumberField label="Screening depth (stage A)" value={s.customDepth.screening} min={6} max={30} onChange={(n) => save({ customDepth: { ...s.customDepth!, screening: n } })} />
              <NumberField label="Deep depth (stage B)" value={s.customDepth.deep} min={8} max={40} onChange={(n) => save({ customDepth: { ...s.customDepth!, deep: n } })} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={<Gauge className="size-4" />} loading={bench === 'running'} onClick={runBenchmark}>Benchmark this device</Button>
            {s.benchmark && (
              <span className="text-sm text-muted">
                Last run: {(s.benchmark.ms / 1000).toFixed(1)} s to depth {BENCHMARK_DEPTH} ({s.benchmark.engine}). Recommended: <span className="text-text">{s.benchmark.recommended}</span>
                {s.benchmark.recommended !== s.preset && <Button size="sm" variant="ghost" className="ml-2" onClick={() => save({ preset: s.benchmark!.recommended })}>Use it</Button>}
              </span>
            )}
          </div>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={s.cloudEval} onChange={(e) => save({ cloudEval: e.target.checked })} />
            <span className="text-sm">
              Use Lichess cloud evaluations for deep analysis when available
              <span className="block text-xs text-muted">Off by default. When on, positions from your games are sent to lichess.org to look up existing deep evaluations, which can save time. The local engine is used when no cloud result is found.</span>
            </span>
          </label>
          {backgroundAnalysis.supported() && <p className="text-xs text-muted">On Android, batch analysis keeps running with the app in the background and shows a notification.</p>}
        </div>
      </Card>

      <Card title="Explanations and training">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="label mb-2">Explanation level</div>
            <Segmented label="Explanation level" value={s.explanationLevel} onChange={(v) => save({ explanationLevel: v })} options={[{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }]} />
            <p className="mt-2 text-xs text-muted">Changes the wording only. Engine evaluations are the same at every level.</p>
          </div>
          <NumberField label="Training acceptance (winning-chance loss)" value={s.trainingAcceptanceWinLoss} min={0} max={15} step={0.5} suffix="%" onChange={(n) => save({ trainingAcceptanceWinLoss: n })} />
        </div>
      </Card>

      <Card title="Move classification thresholds">
        <p className="mb-3 text-sm text-muted">Maximum winning-chance loss (percentage points) for each label. Changes apply to games analyzed afterwards.</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <NumberField label="Excellent ≤" value={t.excellent} min={0} max={t.good} step={0.5} onChange={(n) => setT('excellent', n)} />
          <NumberField label="Good ≤" value={t.good} min={t.excellent} max={t.inaccuracy} step={0.5} onChange={(n) => setT('good', n)} />
          <NumberField label="Inaccuracy ≤" value={t.inaccuracy} min={t.good} max={t.mistake} step={0.5} onChange={(n) => setT('inaccuracy', n)} />
          <NumberField label="Mistake ≤" value={t.mistake} min={t.inaccuracy} max={60} step={0.5} onChange={(n) => setT('mistake', n)} />
          <NumberField label="Great: gap to 2nd" value={t.greatGap} min={5} max={60} onChange={(n) => setT('greatGap', n)} />
          <NumberField label="Brilliant: min sacrifice" value={t.brilliantMinSacrifice} min={1} max={9} suffix="pawns" onChange={(n) => setT('brilliantMinSacrifice', n)} />
        </div>
        <Button className="mt-3" size="sm" variant="ghost" onClick={() => save({ thresholds: DEFAULT_THRESHOLDS })}>Reset to defaults</Button>
      </Card>

      <Card title="Board">
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="label mb-2">Theme</div>
            <Segmented label="Board theme" value={s.boardTheme} onChange={(v) => save({ boardTheme: v })} options={[{ value: 'slate', label: 'Slate' }, { value: 'classic', label: 'Wood' }]} />
          </div>
          <div>
            <div className="label mb-2">Coordinates</div>
            <Segmented label="Coordinates" value={s.showCoordinates ? 'on' : 'off'} onChange={(v) => save({ showCoordinates: v === 'on' })} options={[{ value: 'on', label: 'Show' }, { value: 'off', label: 'Hide' }]} />
          </div>
        </div>
      </Card>

      <Card title="Your data">
        <div className="flex flex-col gap-3">
          {storage && <p className="text-sm text-muted">Using {(storage.usage / 1024 / 1024).toFixed(1)} MB of local storage{storage.quota ? ` (browser allows up to ${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB)` : ''}.</p>}
          <div className="flex flex-wrap gap-2">
            <Button icon={<Download className="size-4" />} onClick={doExport}>Export backup</Button>
            <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Restore backup</Button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => doImport(e.target.files?.[0])} />
          </div>
          <Notice kind="info">Restoring merges a backup into this device. Records that already exist are kept, nothing is deleted. Clearing site data or uninstalling the app removes everything, so export a backup first.</Notice>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => save({ ...DEFAULT_SETTINGS, usernames: s.usernames, benchmark: s.benchmark })}>Reset settings to defaults</Button>
        </div>
      </Card>

      <Card title="About and licences">
        <div className="space-y-2 text-sm text-muted">
          <p>KnightScope analyzes games with <a className="text-primary" href="https://stockfishchess.org" target="_blank" rel="noopener noreferrer">Stockfish</a> (GPL-3.0) via <a className="text-primary" href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener noreferrer">stockfish.js</a>. The engine licence is shipped with the app in engines/STOCKFISH-LICENSE.txt, and the engine source is available at <a className="text-primary" href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener noreferrer">github.com/nmrugg/stockfish.js</a> (the Android build uses the commit and patch listed in native/build-android-engine.sh). Opening names come from the Lichess chess-openings dataset (CC0).</p>
          <p>Move labels, accuracy and explanations are KnightScope’s own heuristics built on engine evaluations. They are not equivalent to any other site’s scores, and the tactic detector does not find every tactic.</p>
        </div>
      </Card>
    </div>
  );
}
