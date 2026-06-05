import { describe, it, expect } from 'vitest';
import { arrayBufferToBase64 } from '@/utils/base64';

describe('arrayBufferToBase64', () => {
  it('converts an empty ArrayBuffer', () => {
    const buf = new ArrayBuffer(0);
    expect(arrayBufferToBase64(buf)).toBe('');
  });

  it('converts a simple string buffer', () => {
    const str = 'hello world';
    const buf = new TextEncoder().encode(str).buffer;
    expect(arrayBufferToBase64(buf)).toBe(btoa(str));
  });

  it('converts large buffers exceeding chunk size (8192)', () => {
    const size = 10000;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      bytes[i] = i % 256;
    }
    const base64 = arrayBufferToBase64(bytes.buffer);

    // Verify round-trip matches
    const decodedBinary = atob(base64);
    expect(decodedBinary.length).toBe(size);
    for (let i = 0; i < size; i++) {
      expect(decodedBinary.charCodeAt(i)).toBe(i % 256);
    }
  });
});
