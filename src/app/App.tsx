import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { db, describeStorageError, requestPersistentStorage } from '@/storage/database/db';
import { Capacitor } from '@capacitor/core';
import { recoverInterruptedJobs, saveSettings } from '@/storage/repositories';
import { nativeEngineInfo } from '@/engine/native/nativeTransport';
import { Logo } from '@/components/layout/Logo';
import { Notice, Spinner } from '@/components/ui';
import { ErrorBoundary } from './providers/ErrorBoundary';

export function App() {
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null });
  useEffect(() => {
    (async () => {
      try {
        await db.open();
        await recoverInterruptedJobs();
        // First launch in the native app: prefer the native engine when this build includes it.
        if (Capacitor.isNativePlatform() && !(await db.settings.get('app'))) {
          const info = await nativeEngineInfo();
          // Native engines are single-threaded, so batch analysis runs several in parallel.
          if (info.available) await saveSettings({ engineFlavor: 'native', maxEngines: Math.max(1, Math.min(3, Math.floor((info.cores ?? 2) / 2) - 1)) });
        }
        void requestPersistentStorage();
        setState({ ready: true, error: null });
      } catch (e) {
        setState({ ready: false, error: describeStorageError(e) });
      }
    })();
  }, []);
  if (state.error) {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col justify-center gap-4 p-6">
        <Logo />
        <Notice kind="error">{state.error}</Notice>
      </div>
    );
  }
  if (!state.ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Opening your local library…" />
      </div>
    );
  }
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
