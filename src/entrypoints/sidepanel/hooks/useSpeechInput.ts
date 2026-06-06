/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useRef, useCallback, useEffect } from 'react';

export interface UseSpeechInputProps {
  onTranscript: (text: string) => void;
  lang?: string;
}

/**
 * useSpeechInput — voice dictation via the Web Speech API.
 *
 * Permission strategy for Chrome extension side panels:
 *
 *   Chrome's side panel is a restricted context where getUserMedia() CANNOT
 *   trigger the native permission popup — it immediately throws NotAllowedError.
 *   The only way to get the browser prompt is from a full extension page (tab).
 *
 *   Flow:
 *   1. User clicks Dictate → we call getUserMedia in the side panel.
 *   2. If it succeeds (permission already granted), start SpeechRecognition.
 *   3. If it fails with NotAllowedError → open permission.html in a new tab.
 *      That page CAN show the native browser prompt because it's a full tab.
 *   4. User clicks Allow on the browser prompt.
 *   5. permission.html sends chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' })
 *      which is received by our onMessage listener in the side panel.
 *   6. We retry getUserMedia — this time it succeeds because the permission
 *      is now granted for the chrome-extension:// origin (shared by all pages).
 *   7. Start SpeechRecognition.
 */
export function useSpeechInput({ onTranscript, lang = '' }: UseSpeechInputProps) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const isActiveRef = useRef(false);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const langRef = useRef(lang);
  langRef.current = lang;

  // ─── Internal: build and start a SpeechRecognition instance ───────────────
  const _startRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = langRef.current || navigator.language || 'en-US';

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join('');
      onTranscriptRef.current(transcript);
    };

    recognition.onend = () => {
      if (isActiveRef.current) {
        setIsListening(false);
        isActiveRef.current = false;
      }
    };

    recognition.onerror = (event: any) => {
      console.error('SpeechRecognition error:', event.error);
      if (isActiveRef.current) {
        setIsListening(false);
        isActiveRef.current = false;
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.error('Failed to start SpeechRecognition:', e);
      setIsListening(false);
      isActiveRef.current = false;
    }
  }, []);

  // ─── Public: startListening ────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    isActiveRef.current = true;
    setIsListening(true);

    // Phase 1: Ensure microphone permission is granted via getUserMedia.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release immediately — SpeechRecognition manages its own mic access.
      stream.getTracks().forEach((t) => t.stop());
    } catch (err: any) {
      const isNotAllowed = err instanceof DOMException && err.name === 'NotAllowedError';

      if (isNotAllowed) {
        // Side panel cannot show the native permission popup.
        // Open a full extension tab that CAN trigger the browser prompt.
        console.log('Side panel cannot prompt for mic. Opening permission page...');
        try {
          await chrome.tabs.create({
            url: chrome.runtime.getURL('permission.html'),
            active: true,
          });
        } catch (tabErr) {
          console.error('Failed to open permission tab:', tabErr);
        }
      } else {
        console.error('Microphone error:', err?.name ?? err);
      }

      // Reset state — the onMessage listener will restart us after permission is granted.
      isActiveRef.current = false;
      setIsListening(false);
      return;
    }

    // Guard: user may have clicked Stop while awaiting getUserMedia.
    if (!isActiveRef.current) return;

    // Phase 2: Permission confirmed — start SpeechRecognition.
    _startRecognition();
  }, [_startRecognition]);

  // ─── Listen for permission-granted message from the permission tab ────────
  useEffect(() => {
    const handler = (msg: any, sender: chrome.runtime.MessageSender) => {
      if (
        msg &&
        typeof msg === 'object' &&
        msg.type === 'MIC_PERMISSION_GRANTED' &&
        sender.id === chrome.runtime.id
      ) {
        console.log('Mic permission granted via permission tab. Starting dictation...');
        // Permission is now persisted for the chrome-extension:// origin.
        // getUserMedia will succeed this time without prompting.
        startListening();
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, [startListening]);

  // ─── Public: stopListening ─────────────────────────────────────────────────
  const stopListening = useCallback(() => {
    isActiveRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }
    setIsListening(false);
  }, []);

  // ─── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  // SpeechRecognition is Chromium-only; the button is hidden on unsupported browsers.
  const isSupported =
    typeof window !== 'undefined' &&
    (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition);

  return { isListening, startListening, stopListening, isSupported };
}
