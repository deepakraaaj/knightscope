import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('KnightScope UI error', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-3 p-8">
        <h1 className="text-lg font-semibold">Something went wrong on this screen</h1>
        <p className="text-sm text-muted">Your saved games and reviews are safe in local storage. Reload the app to continue.</p>
        <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-surface p-3 text-xs text-muted">{this.state.error.message}</pre>
        <button className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
