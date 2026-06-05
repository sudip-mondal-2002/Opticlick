import { describe, it, expect, vi } from 'vitest';
import { tabsShim, setIframeRef } from '../../sandbox/src/chrome-mock/tabs';
import { debuggerShim, writeTempFile, cleanupTempFile } from '../../sandbox/src/chrome-mock/debugger';


describe('tabsShim.onCreated', () => {
  it('defines onCreated event interface with mock methods', () => {
    expect(tabsShim.onCreated).toBeDefined();
    expect(tabsShim.onCreated.addListener).toBeTypeOf('function');
    expect(tabsShim.onCreated.removeListener).toBeTypeOf('function');
    expect(tabsShim.onCreated.hasListener).toBeTypeOf('function');
    expect(tabsShim.onCreated.hasListener()).toBe(false);

    // Call addListener/removeListener to ensure they do not throw
    expect(() => tabsShim.onCreated.addListener(() => {})).not.toThrow();
    expect(() => tabsShim.onCreated.removeListener(() => {})).not.toThrow();
  });
});

describe('debuggerShim.Runtime.evaluate', () => {
  it('correctly evaluates expression when target window is ready', async () => {
    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      HTMLInputElement: class {},
      HTMLTextAreaElement: class {},
      // Custom Function implementation for the iframe window
      Function: function (code: string) {
        if (code.startsWith('return (') && code.endsWith(');')) {
          const inner = code.slice(8, -2).trim();
          if (inner.includes(';') || inner.includes('let ') || inner.includes('const ') || inner.includes('var ') || inner.includes('alert')) {
            throw new SyntaxError('Unexpected token');
          }
        }
        return () => {
          if (code.startsWith('return (') && code.endsWith(');')) {
            const inner = code.slice(8, -2).trim();
            if (inner === 'window.scrollY') return 123;
            if (inner === 'document.title') return 'Opticlick Sandbox';
          } else {
            if (code === 'alert(1);') return undefined;
          }
          return undefined;
        };
      }
    };

    const mockIframe = {
      contentWindow: mockWindow,
      contentDocument: {}
    } as unknown as HTMLIFrameElement;

    setIframeRef(mockIframe);

    const result1 = await debuggerShim.sendCommand({}, 'Runtime.evaluate', {
      expression: 'window.scrollY'
    }) as { result: { value: number } };
    expect(result1.result.value).toBe(123);

    const result2 = await debuggerShim.sendCommand({}, 'Runtime.evaluate', {
      expression: 'document.title'
    }) as { result: { value: string } };
    expect(result2.result.value).toBe('Opticlick Sandbox');

    const result3 = await debuggerShim.sendCommand({}, 'Runtime.evaluate', {
      expression: 'alert(1);' // will trigger syntax error on 'return (alert(1);)' and fall back
    }) as { result: { value: any } };
    expect(result3.result.value).toBeUndefined();
  });

  it('handles exceptions and returns exceptionDetails', async () => {
    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      HTMLInputElement: class {},
      HTMLTextAreaElement: class {},
      Function: function () {
        return () => {
          throw new ReferenceError('nonexistent is not defined');
        };
      }
    };
    const mockIframe = {
      contentWindow: mockWindow,
      contentDocument: {}
    } as unknown as HTMLIFrameElement;

    setIframeRef(mockIframe);

    const result = await debuggerShim.sendCommand({}, 'Runtime.evaluate', {
      expression: 'nonexistent.property'
    }) as { result: { type: string }, exceptionDetails?: { text: string } };

    expect(result.result.type).toBe('undefined');
    expect(result.exceptionDetails).toBeDefined();
    expect(result.exceptionDetails?.text).toContain('nonexistent is not defined');
  });

  it('falls back to statement/block execution when returnable wrapper throws syntax error', async () => {
    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      HTMLInputElement: class {},
      HTMLTextAreaElement: class {},
      Function: function (code: string) {
        if (code.startsWith('return (') && code.endsWith(');')) {
          throw new SyntaxError('Unexpected token');
        }
        return () => {
          if (code === 'let x = 5; return x * 2;') return 10;
          return undefined;
        };
      }
    };
    const mockIframe = {
      contentWindow: mockWindow,
      contentDocument: {}
    } as unknown as HTMLIFrameElement;

    setIframeRef(mockIframe);

    const result = await debuggerShim.sendCommand({}, 'Runtime.evaluate', {
      expression: 'let x = 5; return x * 2;'
    }) as { result: { type: string, value: any } };

    expect(result.result.type).toBe('number');
    expect(result.result.value).toBe(10);
  });

  it('returns subtype node and objectId for HTML Elements and works with DOM.setFileInputFiles', async () => {
    const mockElement = {
      nodeType: 1,
      tagName: 'INPUT',
      files: [],
      dispatchEvent: vi.fn(),
    };

    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      HTMLInputElement: class {},
      HTMLTextAreaElement: class {},
      HTMLElement: class {},
      File: class {
        constructor(public parts: any[], public name: string, public options: any) {}
      },
      DataTransfer: class {
        items = {
          add: vi.fn(),
        };
        get files() {
          return ['mockFileList'];
        }
      },
      Event: class {
        constructor(public type: string, public options?: any) {}
      },
      Function: function () {
        return () => mockElement;
      }
    };

    const mockIframe = {
      contentWindow: mockWindow,
      contentDocument: {}
    } as unknown as HTMLIFrameElement;

    setIframeRef(mockIframe);

    // 1. Runtime.evaluate returns objectId
    const evalResult = await debuggerShim.sendCommand({}, 'Runtime.evaluate', {
      expression: 'document.querySelector("input")'
    }) as { result: { type: string; subtype: string; objectId: string } };

    expect(evalResult.result.type).toBe('object');
    expect(evalResult.result.subtype).toBe('node');
    expect(evalResult.result.objectId).toBeDefined();

    // Write mock file data using writeTempFile
    const { downloadId, filePath } = await writeTempFile('YmFzZTY0ZGF0YQ==', 'test.txt', 'text/plain');

    // 2. DOM.setFileInputFiles updates the element files
    await debuggerShim.sendCommand({}, 'DOM.setFileInputFiles', {
      objectId: evalResult.result.objectId,
      files: [filePath]
    });

    expect(mockElement.files[0]).toBe('mockFileList');
    expect(mockElement.dispatchEvent).toHaveBeenCalledTimes(2);

    await cleanupTempFile(downloadId);
  });
});


describe('debuggerShim.Input.insertText', () => {
  it('types into HTMLInputElement using the correct setter', async () => {
    let inputVal = 'hello ';
    const mockInput = {
      tagName: 'INPUT',
      value: 'hello ',
      dispatchEvent: vi.fn(),
    };

    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      InputEvent: class {},
      Event: class {},
      HTMLInputElement: {
        prototype: {
          // Mock prototype setter
          get value() {
            return inputVal;
          },
          set value(v: string) {
            inputVal = v;
          }
        }
      },
      HTMLTextAreaElement: {
        prototype: {}
      }
    };

    // Set prototype of mockInput to mock HTMLInputElement.prototype
    Object.setPrototypeOf(mockInput, mockWindow.HTMLInputElement.prototype);

    const mockIframe = {
      contentWindow: mockWindow,
      contentDocument: {
        activeElement: mockInput
      }
    } as unknown as HTMLIFrameElement;

    setIframeRef(mockIframe);

    await debuggerShim.sendCommand({}, 'Input.insertText', { text: 'world' });
    expect(inputVal).toBe('hello world');
    expect(mockInput.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('types into HTMLTextAreaElement using the correct setter', async () => {
    let textareaVal = 'copilot ';
    const mockTextArea = {
      tagName: 'TEXTAREA',
      value: 'copilot ',
      dispatchEvent: vi.fn(),
    };

    const mockWindow = {
      innerWidth: 1024,
      innerHeight: 768,
      InputEvent: class {},
      Event: class {},
      HTMLInputElement: {
        prototype: {}
      },
      HTMLTextAreaElement: {
        prototype: {
          // Mock prototype setter
          get value() {
            return textareaVal;
          },
          set value(v: string) {
            textareaVal = v;
          }
        }
      }
    };

    // Set prototype of mockTextArea to mock HTMLTextAreaElement.prototype
    Object.setPrototypeOf(mockTextArea, mockWindow.HTMLTextAreaElement.prototype);

    const mockIframe = {
      contentWindow: mockWindow,
      contentDocument: {
        activeElement: mockTextArea
      }
    } as unknown as HTMLIFrameElement;

    setIframeRef(mockIframe);

    await debuggerShim.sendCommand({}, 'Input.insertText', { text: 'workday' });
    expect(textareaVal).toBe('copilot workday');
    expect(mockTextArea.dispatchEvent).toHaveBeenCalledTimes(2);
  });
});
