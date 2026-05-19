declare module '@electron/rebuild' {
  import type { EventEmitter } from 'node:events';

  export type RebuildOptions = {
    arch?: string;
    buildFromSource?: boolean;
    buildPath?: string;
    electronVersion?: string;
    force?: boolean;
    mode?: string;
    onlyModules?: string[];
    platform?: string;
    projectRootPath?: string;
  };

  export type RebuildResult = Promise<void> & {
    lifecycle: EventEmitter;
  };

  export function rebuild(options: RebuildOptions): RebuildResult;
}
