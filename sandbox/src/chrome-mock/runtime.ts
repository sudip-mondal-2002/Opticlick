/**
 * chrome.runtime shim
 *
 * Implements EventEmitter-based chrome.runtime.sendMessage and chrome.runtime.onMessage
 * shims, supporting background-to-foreground communication.
 */

type MessageCallback = (response: any) => void;
type RuntimeListener = (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: MessageCallback
) => boolean | void | Promise<void>;

class RuntimeEventBus {
  private listeners = new Set<RuntimeListener>();

  public addListener(listener: RuntimeListener): void {
    this.listeners.add(listener);
  }

  public removeListener(listener: RuntimeListener): void {
    this.listeners.delete(listener);
  }

  public has(listener: RuntimeListener): boolean {
    return this.listeners.has(listener);
  }

  public emit(message: any, sender: chrome.runtime.MessageSender, callback?: MessageCallback): void {
    for (const listener of this.listeners) {
      try {
        const isAsync = listener(message, sender, (response) => {
          if (callback) callback(response);
        });
        if (isAsync === true) {
          // Keep channel open for async response
        }
      } catch (err) {
        console.error('[Runtime Shim] Error in message listener:', err);
      }
    }
  }
}

export const runtimeEventBus = new RuntimeEventBus();
let _agentRunning = false;

export const runtimeShim = {
  id: 'opticlick-sandbox-extension',

  sendMessage(
    message: any,
    options?: any,
    responseCallback?: MessageCallback
  ): Promise<any> {
    const cb = typeof options === 'function' ? options : responseCallback;

    if (message?.type === 'START_AGENT') {
      if (_agentRunning) {
        cb?.({ started: false, reason: 'already_running' });
        return Promise.resolve({ started: false });
      }
      _agentRunning = true;
      import('../agent-runner')
        .then(({ runSandboxAgent }) => {
          return runSandboxAgent(message);
        })
        .catch(error => {
          console.error('[Runtime Shim] Error running sandbox agent:', error);
          cb?.({ started: false, reason: 'crashed' });
          runtimeEventBus.emit({
            type: 'AGENT_STATE_CHANGE',
            running: false,
            reason: 'crashed',
            error: error instanceof Error ? error.message : String(error)
          }, { id: this.id } as any);
        })
        .finally(() => {
          _agentRunning = false;
        });
      cb?.({ started: true });
      return Promise.resolve({ started: true });
    }

    if (message?.type === 'STOP_AGENT') {
      import('../agent-runner').then(({ stopSandboxAgent }) => stopSandboxAgent());
      runtimeEventBus.emit({ type: 'AGENT_STATE_CHANGE' }, { id: this.id });
      cb?.({ stopped: true });
      return Promise.resolve({ stopped: true });
    }

    const sender: chrome.runtime.MessageSender = { id: this.id, tab: { id: 1 } as any };
    runtimeEventBus.emit(message, sender, cb);

    return Promise.resolve();
  },

  onMessage: {
    addListener(listener: RuntimeListener): void {
      runtimeEventBus.addListener(listener);
    },
    removeListener(listener: RuntimeListener): void {
      runtimeEventBus.removeListener(listener);
    },
    hasListener(listener: RuntimeListener): boolean {
      return runtimeEventBus.has(listener);
    }
  },

  lastError: null,

  getManifest(): chrome.runtime.Manifest {
    return {
      manifest_version: 3,
      name: 'Opticlick Engine (Sandbox)',
      version: '1.0.0-sandbox',
    } as any;
  },

  getURL(path: string): string {
    return '/' + path.replace(/^\//, '');
  }
};
