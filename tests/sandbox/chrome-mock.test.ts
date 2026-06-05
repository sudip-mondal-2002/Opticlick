import { describe, it, expect, vi } from 'vitest';
import { tabsShim, setIframeRef } from '../../sandbox/src/chrome-mock/tabs';
import { debuggerShim } from '../../sandbox/src/chrome-mock/debugger';

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
        return () => {
          if (code === 'return (window.scrollY);') return 123;
          if (code === 'return (document.title);') return 'Opticlick Sandbox';
          return 'raw block fallback';
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
    }) as { result: { value: string } };
    expect(result3.result.value).toBe('raw block fallback');
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
