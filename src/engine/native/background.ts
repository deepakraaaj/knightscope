import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Android only: a foreground service with a visible notification keeps the app process alive while a
 * batch analysis runs with the app minimised. iOS does not allow this kind of background execution,
 * and browsers suspend background tabs, so on those platforms analysis pauses until the app returns
 * (the queue is persisted and resumes from the last saved position).
 */
interface BackgroundPlugin {
  start(options: { title: string; text: string }): Promise<void>;
  stop(): Promise<void>;
}

const Plugin = registerPlugin<BackgroundPlugin>('KnightScopeBackground');

function supported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('KnightScopeBackground');
}

export const backgroundAnalysis = {
  supported,
  start() {
    if (!supported()) return;
    Plugin.start({ title: 'KnightScope', text: 'Analysing your games' }).catch(() => undefined);
  },
  stop() {
    if (!supported()) return;
    Plugin.stop().catch(() => undefined);
  },
};
