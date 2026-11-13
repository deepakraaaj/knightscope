import { Link } from 'react-router-dom';

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="KnightScope home">
      <svg viewBox="0 0 64 64" className="size-7" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#1A2538" />
        <circle cx="32" cy="32" r="22" fill="none" stroke="#7C9CFF" strokeWidth="3" />
        <path d="M24 46h18v-4l-3-2c0-6 3-9 3-15 0-6-5-10-11-10l-2 4-4 2-3 6 2 2 5-2 2 1c-4 4-7 8-7 13l-3 1z" fill="#F5F7FB" />
        <circle cx="29" cy="22" r="1.6" fill="#1A2538" />
      </svg>
      <span className="font-display text-[15px] font-semibold tracking-tight">KnightScope</span>
    </Link>
  );
}
