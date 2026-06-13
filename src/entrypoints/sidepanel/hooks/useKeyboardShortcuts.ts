import { useEffect } from 'react';

interface ShortcutHandlers {
  isRunning: boolean;
  onStop: () => void;
  onOpenSettings: () => void;
  onOpenHistory: () => void;
  onOpenTemplates: () => void;
  onNewChat: () => void;
  onCloseOverlay: () => void;
  onFocusInput: () => void;
  onShowShortcuts: () => void;
}

export function useKeyboardShortcuts({
  isRunning,
  onStop,
  onOpenSettings,
  onOpenHistory,
  onOpenTemplates,
  onNewChat,
  onCloseOverlay,
  onFocusInput,
  onShowShortcuts,
}: ShortcutHandlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      const allowWhileTyping =
        (mod && e.key === '.') ||
        e.key === 'Escape';

      if (isTyping && !allowWhileTyping) {
        return;
      }

      if (mod && e.key === '.') {
        e.preventDefault();
        if (isRunning) onStop();
      }

      if (mod && e.key === ',') {
        e.preventDefault();
        onOpenSettings();
      }

      if (mod && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        onOpenHistory();
      }

      if (mod && e.key.toLowerCase() === 't') {
        e.preventDefault();
        onOpenTemplates();
      }

      if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onNewChat();
      }

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onFocusInput();
      }

      if (mod && e.key === '/') {
        e.preventDefault();
        onShowShortcuts();
      }

      if (e.key === 'Escape') {
        const closed = onCloseOverlay();
        if (closed) e.preventDefault();
      }
    };

    document.addEventListener('keydown', handler);

    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [
    isRunning,
    onStop,
    onOpenSettings,
    onOpenHistory,
    onOpenTemplates,
    onNewChat,
    onCloseOverlay,
    onFocusInput,
    onShowShortcuts,
  ]);
}
