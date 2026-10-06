import type { BoofvizApi } from '../shared/ipc';

declare global {
  interface Window {
    boofviz: BoofvizApi;
  }
}

export {};
