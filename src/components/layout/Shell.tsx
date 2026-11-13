import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { BarChart3, BookOpenCheck, BrainCircuit, Download, Gauge, LayoutDashboard, Menu, Microscope, Settings, Target, X } from 'lucide-react';
import { db } from '@/storage/database/db';
import { useRunner } from '@/engine/scheduler/runnerStore';
import { cx, Toaster } from '@/components/ui';
import { Logo } from './Logo';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/import', label: 'Import Games', icon: Download },
  { to: '/games', label: 'Game Review', icon: BookOpenCheck },
  { to: '/analysis', label: 'Analysis Board', icon: Microscope },
  { to: '/mistakes', label: 'Mistake Memory', icon: BrainCircuit },
  { to: '/training', label: 'Training Lab', icon: Target },
  { to: '/analytics', label: 'Improvement Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

const MOBILE_TABS = ['/', '/games', '/mistakes', '/training'];

function QueueIndicator({ compact }: { compact?: boolean }) {
  const running = useRunner((s) => s.running);
  const live = useRunner((s) => s.live);
  const counts = useLiveQuery(async () => ({
    queued: await db.queue.where('status').equals('queued').count(),
    paused: await db.queue.where('status').equals('paused').count(),
  }), [], { queued: 0, paused: 0 });
  const current = Object.values(live)[0];
  if (!running && counts.queued === 0 && counts.paused === 0) return null;
  return (
    <NavLink to="/import#queue" className={cx('flex items-center gap-2 rounded-lg border border-border bg-elevated text-xs', compact ? 'px-2 py-1' : 'mx-3 mb-3 px-3 py-2')}>
      <Gauge className={cx('size-4', running ? 'animate-pulse text-primary' : 'text-muted')} aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {running
          ? current
            ? `${current.stage === 'screening' ? 'Screening' : current.stage === 'deep' ? 'Deep pass' : 'Building review'} · ${current.stage === 'screening' ? `${current.positionsDone}/${current.positionsTotal}` : `${current.deepDone}/${current.deepTotal}`}`
            : 'Starting engine…'
          : `${counts.paused} paused · ${counts.queued} queued`}
      </span>
    </NavLink>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
      {NAV.map(({ to, label, icon: Icon, ...rest }) => (
        <NavLink
          key={to}
          to={to}
          end={'end' in rest}
          onClick={onNavigate}
          className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-elevated text-text' : 'text-muted hover:bg-elevated/60 hover:text-text')}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Shell({ banner }: { banner?: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  return (
    <div className="flex h-full min-h-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-1 focus:text-bg">
        Skip to content
      </a>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface/60 lg:flex">
        <div className="px-6 py-5">
          <Logo />
        </div>
        <NavItems />
        <div className="mt-auto pt-4">
          <QueueIndicator />
          <p className="px-6 pb-4 text-[11px] leading-relaxed text-muted/70">Analysis runs locally with Stockfish. Your games never leave this device unless you export them.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur lg:hidden">
          <Logo />
          <div className="flex items-center gap-2">
            <QueueIndicator compact />
            <button onClick={() => setDrawer(true)} aria-label="Open menu" className="rounded-lg p-2 text-muted hover:bg-elevated hover:text-text">
              <Menu className="size-5" />
            </button>
          </div>
        </header>
        {banner}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-0" key={loc.pathname.split('/')[1]}>
          <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
        <nav aria-label="Primary" className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
          {NAV.filter((n) => MOBILE_TABS.includes(n.to)).map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink key={to} to={to} end={'end' in rest} className={({ isActive }) => cx('flex flex-col items-center gap-1 py-2 text-[10px]', isActive ? 'text-primary' : 'text-muted')}>
              <Icon className="size-5" aria-hidden />
              {label.replace(' Memory', '').replace(' Lab', '').replace('Game ', '')}
            </NavLink>
          ))}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-1 py-2 text-[10px] text-muted">
            <Menu className="size-5" aria-hidden />
            More
          </button>
        </nav>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setDrawer(false)}>
          <div className="safe-top absolute inset-y-0 right-0 flex w-72 flex-col border-l border-border bg-surface py-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Menu">
            <div className="mb-4 flex items-center justify-between px-6">
              <Logo />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-lg p-2 text-muted hover:text-text">
                <X className="size-5" />
              </button>
            </div>
            <NavItems onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <Toaster />
    </div>
  );
}
