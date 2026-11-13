import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kritilabs.knightscope',
  appName: 'KnightScope',
  webDir: 'dist',
  android: { backgroundColor: '#0B1020' },
  ios: { backgroundColor: '#0B1020', contentInset: 'always' },
};

export default config;
