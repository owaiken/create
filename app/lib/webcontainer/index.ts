// FlyContainer - A WebContainer replacement using Fly.io backend
import { WORK_DIR_NAME } from '~/utils/constants';
import { cleanStackTrace } from '~/utils/stacktrace';

// Fly.io backend URL
const FLY_BACKEND_URL = 'https://create-fly-backend.fly.dev';

// Type definitions to match WebContainer API
interface FlyContainerContext {
  loaded: boolean;
}

// Define a FlyContainer class that mimics WebContainer API
class FlyContainer {
  workdir: string;
  protected eventListeners: Record<string, Array<(message: any) => void>> = {};
  protected previewId: string;

  constructor(workdir: string) {
    this.workdir = workdir;
    this.previewId = crypto.randomUUID();
  }

  // File system operations
  fs = {
    readFile: async (path: string, encoding: string = 'utf-8') => {
      const response = await fetch(
        `${FLY_BACKEND_URL}/api/files/read/${this.previewId}?path=${encodeURIComponent(path)}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to read file: ${path}`);
      }

      const data = (await response.json()) as { content: string };

      return data.content;
    },

    writeFile: async (path: string, content: string, options?: { encoding?: string }) => {
      const response = await fetch(`${FLY_BACKEND_URL}/api/files/write/${this.previewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      });

      if (!response.ok) {
        throw new Error(`Failed to write file: ${path}`);
      }

      return;
    },

    mkdir: async (path: string, options?: { recursive?: boolean }) => {
      const response = await fetch(`${FLY_BACKEND_URL}/api/files/mkdir/${this.previewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, recursive: options?.recursive }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create directory: ${path}`);
      }

      return;
    },

    readdir: async (path: string, options?: { withFileTypes?: boolean }) => {
      const response = await fetch(
        `${FLY_BACKEND_URL}/api/files/readdir/${this.previewId}?path=${encodeURIComponent(path)}&withFileTypes=${options?.withFileTypes || false}`,
      );

      if (!response.ok) {
        throw new Error(`Failed to read directory: ${path}`);
      }

      const data = (await response.json()) as { entries: any[] };

      return data.entries;
    },

    rm: async (path: string, options?: { recursive?: boolean }) => {
      const response = await fetch(`${FLY_BACKEND_URL}/api/files/rm/${this.previewId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, recursive: options?.recursive }),
      });

      if (!response.ok) {
        throw new Error(`Failed to remove: ${path}`);
      }

      return;
    },

    watch: async (pattern: string, options?: { persistent?: boolean }) => {
      console.log(`Watch not fully implemented for pattern: ${pattern}`);
      return {
        close: () => {},
      };
    },
  };

  // Process execution
  async spawn(command: string, args: string[] = [], options?: { cwd?: string }) {
    const response = await fetch(`${FLY_BACKEND_URL}/api/execute/${this.previewId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command,
        args,
        cwd: options?.cwd || '/',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to execute command: ${command}`);
    }

    const { processId } = (await response.json()) as { processId: string };

    // Create a WebSocket connection to receive process output
    const ws = new WebSocket(`wss://${FLY_BACKEND_URL.replace('https://', '')}/ws?previewId=${this.previewId}`);

    // Return a process-like object
    return {
      output: {
        pipeTo: async (writable: WritableStream) => {
          const writer = writable.getWriter();

          ws.onmessage = async (event) => {
            try {
              const data = JSON.parse(event.data);

              if (data.processId === processId && data.type === 'process-output') {
                await writer.write(new TextEncoder().encode(data.output));
              }

              if (data.processId === processId && data.type === 'process-completed') {
                await writer.close();
                ws.close();
              }
            } catch (error) {
              console.error('Error processing WebSocket message:', error);
            }
          };

          return {
            exitCode: new Promise<number>((resolve) => {
              ws.onmessage = (event) => {
                try {
                  const data = JSON.parse(event.data);

                  if (data.processId === processId && data.type === 'process-completed') {
                    resolve(data.exitCode);
                    ws.close();
                  }
                } catch (error) {
                  console.error('Error processing WebSocket message:', error);
                }
              };
            }),
          };
        },

        // Add tee method to split the output stream
        tee: () => {
          const stream = new ReadableStream<string>({
            start(controller) {
              ws.onmessage = (event) => {
                try {
                  const data = JSON.parse(event.data);

                  if (data.processId === processId && data.type === 'process-output') {
                    controller.enqueue(data.output);
                  }

                  if (data.processId === processId && data.type === 'process-completed') {
                    controller.close();
                    ws.close();
                  }
                } catch (error) {
                  console.error('Error processing WebSocket message:', error);
                  controller.error(error);
                }
              };
            },
          });
          return stream.tee() as [ReadableStream<string>, ReadableStream<string>];
        },

        // Add getReader method
        getReader: () => {
          const stream = new ReadableStream<string>({
            start(controller) {
              ws.onmessage = (event) => {
                try {
                  const data = JSON.parse(event.data);

                  if (data.processId === processId && data.type === 'process-output') {
                    controller.enqueue(data.output);
                  }

                  if (data.processId === processId && data.type === 'process-completed') {
                    controller.close();
                    ws.close();
                  }
                } catch (error) {
                  console.error('Error processing WebSocket message:', error);
                  controller.error(error);
                }
              };
            },
          });
          return stream.getReader();
        },
      },

      // Add input property
      input: {
        getWriter: () => {
          const stream = new WritableStream<string>({
            write(chunk) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    processId,
                    type: 'process-input',
                    input: chunk,
                  }),
                );
              }
            },
          });
          return stream.getWriter();
        },
      },
      exit: new Promise<number>((resolve) => {
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.processId === processId && data.type === 'process-completed') {
              resolve(data.exitCode);
              ws.close();
            }
          } catch (error) {
            console.error('Error processing WebSocket message:', error);
          }
        };
      }),
    };
  }

  // Event handling
  on(event: string, callback: (message: any) => void) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }

    this.eventListeners[event].push(callback);

    return this;
  }

  off(event: string, callback: (message: any) => void) {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter((cb) => cb !== callback);
    }

    return this;
  }

  // Static method to create a new instance
  static async boot(options: { coep?: string; workdirName?: string; forwardPreviewErrors?: boolean }) {
    const container = new FlyContainer(options.workdirName || WORK_DIR_NAME);
    return container;
  }

  // Get the preview URL for this container
  getPreviewUrl() {
    return `${FLY_BACKEND_URL}/preview/${this.previewId}`;
  }

  // Public accessor for previewId
  getPreviewId() {
    return this.previewId;
  }

  // Public accessor for event listeners
  getEventListeners(event: string) {
    return this.eventListeners[event] || [];
  }
}

export const webcontainerContext: FlyContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

export let webcontainer: Promise<FlyContainer> = new Promise(() => {
  // noop for ssr
});

if (!import.meta.env.SSR) {
  webcontainer =
    import.meta.hot?.data.webcontainer ??
    Promise.resolve()
      .then(() => {
        return FlyContainer.boot({
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });
      })
      .then(async (webcontainer) => {
        webcontainerContext.loaded = true;

        const { workbenchStore } = await import('~/lib/stores/workbench');

        // Set up WebSocket connection for preview messages
        const ws = new WebSocket(
          `wss://${FLY_BACKEND_URL.replace('https://', '')}/ws?previewId=${webcontainer.getPreviewId()}`,
        );
        
        // Emit server-ready event with Fly.io backend URL
        const previewId = webcontainer.getPreviewId();
        const flyBackendPreviewUrl = `${FLY_BACKEND_URL}/preview/${previewId}`;
        
        console.log('[FlyContainer] Preview ID:', previewId);
        console.log('[FlyContainer] Backend Preview URL:', flyBackendPreviewUrl);
        
        // Emit server-ready event with the Fly.io backend URL immediately
        // and also after a short delay to ensure listeners are registered
        const emitServerReady = () => {
          const serverReadyListeners = webcontainer.getEventListeners('server-ready');
          console.log('[FlyContainer] Server ready listeners count:', serverReadyListeners.length);
          
          if (serverReadyListeners.length > 0) {
            console.log('[FlyContainer] Emitting server-ready event');
            for (const listener of serverReadyListeners) {
              listener({
                port: 4321,  // Use a standard port for consistency
                url: flyBackendPreviewUrl,
                previewId: previewId
              });
            }
          } else {
            console.log('[FlyContainer] No server-ready listeners found, will retry');
            // If no listeners, try again after a short delay
            setTimeout(emitServerReady, 1000);
          }
        };
        
        // Try to emit immediately
        emitServerReady();
        
        // Also force a server-ready event after 2 seconds as a fallback
        setTimeout(async () => {
          console.log('[FlyContainer] Forcing server-ready event emission');
          try {
            // Force emit a server-ready event directly
            // Get the previews store instance
            const { workbenchStore } = await import('~/lib/stores/workbench');
            const previews = workbenchStore.previews.get();
            console.log('[FlyContainer] Current previews:', previews);
            
            // Manually add a preview if none exists
            if (previews.length === 0) {
              console.log('[FlyContainer] Adding preview manually');
              workbenchStore.previews.set([{
                port: 4321,
                ready: true,
                baseUrl: flyBackendPreviewUrl
              }]);
              console.log('[FlyContainer] Forced preview added');
            }
          } catch (error) {
            console.error('[FlyContainer] Error forcing preview:', error);
          }
        }, 2000);

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Forward messages to registered listeners
            const listeners = webcontainer.getEventListeners('preview-message');

            if (listeners.length > 0) {
              for (const listener of listeners) {
                listener(message);
              }
            }

            // Handle preview errors
            if (message.type === 'PREVIEW_UNCAUGHT_EXCEPTION' || message.type === 'PREVIEW_UNHANDLED_REJECTION') {
              const isPromise = message.type === 'PREVIEW_UNHANDLED_REJECTION';
              workbenchStore.actionAlert.set({
                type: 'preview',
                title: isPromise ? 'Unhandled Promise Rejection' : 'Uncaught Exception',
                description: message.message,
                content: `Error occurred at ${message.pathname || ''}${message.search || ''}${message.hash || ''}\nStack trace:\n${cleanStackTrace(message.stack || '')}`,
                source: 'preview',
              });
            }
          } catch (error) {
            console.error('Error processing WebSocket message:', error);
          }
        };

        return webcontainer;
      });

  if (import.meta.hot) {
    import.meta.hot.data.webcontainer = webcontainer;
  }
}
