import { registerPlugin } from '@capacitor/core';
import type { NativeVideoPlayerPlugin } from './definitions';

const NativeVideoPlayer = registerPlugin<NativeVideoPlayerPlugin>('NativeVideoPlayer', {
  web: () => import('./web').then((m) => new m.NativeVideoPlayerWeb()),
});

export * from './definitions';
export { NativeVideoPlayer };

