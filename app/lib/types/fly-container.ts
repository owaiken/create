// Type definitions for FlyContainer (replacement for WebContainer)

export interface FlyContainer {
  workdir: string;
  fs: {
    readFile: (path: string, encoding?: string) => Promise<string>;
    writeFile: (path: string, content: string, options?: { encoding?: string }) => Promise<void>;
    mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
    readdir: (path: string, options?: { withFileTypes?: boolean }) => Promise<any[]>;
    rm: (path: string, options?: { recursive?: boolean }) => Promise<void>;
    watch: (pattern: string, options?: { persistent?: boolean }) => Promise<{ close: () => void }>;
  };
  spawn: (command: string, args?: string[], options?: { cwd?: string, terminal?: { cols: number, rows: number } }) => Promise<{
    output: {
      pipeTo: (writable: WritableStream) => Promise<{ exitCode: Promise<number> }>;
    };
    exit: Promise<number>;
  }>;
  on: (event: string, callback: (message: any) => void) => FlyContainer;
  off: (event: string, callback: (message: any) => void) => FlyContainer;
  getPreviewUrl: () => string;
}

export interface PathWatcherEvent {
  type: string;
  path: string;
}

export interface WebContainerProcess {
  output: {
    pipeTo: (writable: WritableStream) => Promise<{ exitCode: Promise<number> }>;
    getReader?: () => ReadableStreamDefaultReader<string>;
    tee?: () => [ReadableStream<string>, ReadableStream<string>];
  } | { pipeTo: (writable: WritableStream) => Promise<{ exitCode: Promise<number> }> };
  input?: {
    getWriter: () => WritableStreamDefaultWriter<string>;
  } | any; // Make input more flexible to accommodate different implementations
  exit: Promise<number>;
  resize?: (dimensions: { cols: number; rows: number }) => void;
}

export interface AuthAPI {
  // Define any auth methods needed
}

export const auth: AuthAPI = {
  // Implement any auth methods needed
};
