import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { create } from 'zustand';
import { tone } from '@/app/providers/theme';
import { AlertTriangle, CheckCircle2, ChessBishop, ChessKing, ChessKnight, ChessPawn, ChessQueen, ChessRook, Info, Loader2, X, type LucideIcon } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover font-semibold',
  secondary: 'bg-elevated text-text border border-border hover:border-border-strong hover:bg-hover',
  ghost: 'text-muted hover:text-text hover:bg-elevated',
  danger: 'bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20',
};

export function Button({ variant = 'secondary', size = 'md', loading, icon, children, className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button {...rest} aria-label={label} title={label} className={cx('inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40', className)}>
      {children}
    </button>
  );
}

export type PieceName = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
const PIECES: Record<PieceName, LucideIcon> = { king: ChessKing, queen: ChessQueen, rook: ChessRook, bishop: ChessBishop, knight: ChessKnight, pawn: ChessPawn };

/** Large faded chess piece used as decorative card artwork. */
export function PieceWatermark({ piece, className }: { piece: PieceName; className?: string }) {
  const Icon = PIECES[piece];
  return <Icon aria-hidden strokeWidth={1.25} className={cx('pointer-events-none absolute -bottom-4 -right-3 size-24 rotate-[-12deg] text-primary opacity-[0.07]', className)} />;
}

/** Small tinted icon tile used in card headers and stat cards. */
export function IconChip({ icon: Icon, color = 'var(--color-primary)', size = 'md' }: { icon: LucideIcon; color?: string; size?: 'sm' | 'md' }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-lg', size === 'sm' ? 'size-7' : 'size-9')} style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }} aria-hidden>
      <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} />
    </span>
  );
}

/** One-line plain-language explanation shown under a heading. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('flex items-start gap-1.5 text-xs text-muted', className)}>
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export function Card({ children, className, title, action, padded = true, icon, piece, hint }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; padded?: boolean; icon?: LucideIcon; piece?: PieceName; hint?: ReactNode }) {
  return (
    <section className={cx('card relative overflow-hidden', className)}>
      {piece && <PieceWatermark piece={piece} className="size-32 -bottom-6 -right-4" />}
      {(title || action) && (
        <header className="relative flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && <IconChip icon={icon} size="sm" />}
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{title}</h2>
              {hint && <p className="mt-0.5 text-xs font-normal text-muted">{hint}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      <div className={cx('relative', padded && 'p-4')}>{children}</div>
    </section>
  );
}

export function Badge({ children, color, className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', className)} style={color ? { color: tone(color), background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}40` } : undefined}>
      {children}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className)} aria-hidden />;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-3 overflow-hidden px-6 py-12 text-center">
      <ChessKnight aria-hidden strokeWidth={1} className="pointer-events-none absolute left-1/2 top-1/2 size-56 -translate-x-1/2 -translate-y-1/2 text-primary opacity-[0.05]" />
      <div className="relative flex size-11 items-center justify-center rounded-xl border border-border bg-elevated text-primary">{icon}</div>
      <h3 className="relative text-base font-semibold">{title}</h3>
      <div className="relative max-w-md text-sm text-muted">{body}</div>
      {action && <div className="relative">{action}</div>}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="input h-9 py-0 pr-8">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', value === o.value ? 'bg-elevated text-text shadow-sm' : 'text-muted hover:text-text')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, hint, to, icon, piece, color }: { label: string; value: ReactNode; hint?: ReactNode; to?: string; icon?: LucideIcon; piece?: PieceName; color?: string }) {
  const body = (
    <>
      {piece && <PieceWatermark piece={piece} />}
      <div className="relative flex items-center gap-2">
        {icon && <IconChip icon={icon} size="sm" color={color} />}
        <div className="label">{label}</div>
      </div>
      <div className="tabular relative mt-2 font-display text-2xl font-semibold">{value}</div>
      {hint && <div className="relative mt-1 text-xs text-muted">{hint}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card relative block overflow-hidden p-4 transition-colors hover:border-border-strong hover:bg-surface-hover">
      {body}
    </Link>
  ) : (
    <div className="card relative overflow-hidden p-4">{body}</div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({ kind = 'info', children, className }: { kind?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode; className?: string }) {
  const map = {
    info: { icon: <Info className="size-4 shrink-0" />, cls: 'border-primary/30 bg-primary/5 text-info-fg' },
    warn: { icon: <AlertTriangle className="size-4 shrink-0" />, cls: 'border-warn/30 bg-warn/5 text-warn-fg' },
    error: { icon: <AlertTriangle className="size-4 shrink-0" />, cls: 'border-bad/30 bg-bad/5 text-error-fg' },
    success: { icon: <CheckCircle2 className="size-4 shrink-0" />, cls: 'border-good/30 bg-good/5 text-success-fg' },
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm', map.cls, className)}>
      <span className="mt-0.5">{map.icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cx('card max-h-[92vh] w-full overflow-y-auto rounded-b-none outline-none sm:rounded-xl', wide ? 'sm:max-w-5xl' : 'sm:max-w-lg')}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts

interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}
const useToasts = create<{ toasts: Toast[]; push: (t: Omit<Toast, 'id'>) => void; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.kind === 'error' ? 8000 : 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  info: (text: string) => useToasts.getState().push({ kind: 'info', text }),
  success: (text: string) => useToasts.getState().push({ kind: 'success', text }),
  error: (text: string) => useToasts.getState().push({ kind: 'error', text }),
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border bg-elevated px-3 py-2.5 text-sm shadow-xl', t.kind === 'error' ? 'border-bad/40' : t.kind === 'success' ? 'border-good/40' : 'border-border')}>
          {t.kind === 'error' ? <AlertTriangle className="mt-0.5 size-4 text-bad" /> : t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 text-good" /> : <Info className="mt-0.5 size-4 text-primary" />}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-muted hover:text-text">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, description, actions, icon, steps }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: LucideIcon; steps?: string[] }) {
  return (
    <div className="mb-2 flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-start gap-3">
          {icon && <IconChip icon={icon} />}
          <div>
            <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
            {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {steps && steps.length > 0 && (
        <ol className="flex flex-wrap gap-2" aria-label="How this page works">
          {steps.map((step, i) => (
            <li key={step} className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
              <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-on-primary">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
