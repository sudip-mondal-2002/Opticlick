import { useState, useMemo } from 'react';
import type { PromptTemplate } from '@/utils/types';

function BookmarkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}


interface TemplateCardProps {
  template: PromptTemplate;
  onUse: (template: PromptTemplate) => void;
  onSave: (template: PromptTemplate) => void;
  onDelete: (id: string) => void;
}

function TemplateCard({ template, onUse, onSave, onDelete }: TemplateCardProps) {
  const [editMode, setEditMode] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [editName, setEditName] = useState(template.name);
  const [editPrompt, setEditPrompt] = useState(template.prompt);

  const handleSaveEdit = () => {
    const trimmedName = editName.trim();
    const trimmedPrompt = editPrompt.trim();
    if (trimmedName && trimmedPrompt) {
      onSave({ ...template, name: trimmedName, prompt: trimmedPrompt });
      setEditMode(false);
    }
  };

  const handleCancel = () => {
    setEditName(template.name);
    setEditPrompt(template.prompt);
    setEditMode(false);
  };

  if (editMode) {
    return (
      <div className="border-b border-slate-100 dark:border-slate-800/60 px-4 py-3 space-y-2">
        <input
          autoFocus
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          placeholder="Template name…"
          className="w-full px-2.5 py-1.5 text-[12px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
        />
        <textarea
          value={editPrompt}
          onChange={(e) => setEditPrompt(e.target.value)}
          placeholder="Template prompt…"
          rows={3}
          className="w-full px-2.5 py-1.5 text-[12px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 resize-none"
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleCancel}
            className="px-2.5 py-1 text-[11px] font-medium rounded-[6px] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveEdit}
            disabled={!editName.trim() || !editPrompt.trim()}
            className="px-2.5 py-1 text-[11px] font-medium rounded-[6px] bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-40 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  if (pendingDelete) {
    return (
      <div className="px-4 py-2 flex items-center gap-2 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-100 dark:border-rose-900">
        <span className="flex-1 text-[11px] text-rose-600 dark:text-rose-400">Delete &quot;{template.name}&quot;?</span>
        <button
          onClick={() => { onDelete(template.id); setPendingDelete(false); }}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-[6px] bg-rose-500 text-white hover:bg-rose-600 transition-colors"
        >
          Delete
        </button>
        <button
          onClick={() => setPendingDelete(false)}
          className="px-2.5 py-1 text-[10px] font-semibold rounded-[6px] border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => onUse(template)}
      className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 group"
    >
      <div className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800/60 flex items-center justify-center text-sky-500 flex-none">
        <BookmarkIcon />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200 leading-snug line-clamp-1">
          {template.name}
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 line-clamp-2 leading-snug">
          {template.prompt}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-none">
        <button
          onClick={(e) => { e.stopPropagation(); setEditMode(true); }}
          className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          title="Edit"
        >
          <EditIcon />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setPendingDelete(true); }}
          className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
          title="Delete"
        >
          <TrashIcon />
        </button>
      </div>
    </button>
  );
}

interface Props {
  templates: PromptTemplate[];
  onClose: () => void;
  onUse: (template: PromptTemplate) => void;
  onSave: (template: PromptTemplate) => void;
  onDelete: (id: string) => void;
}

export function TemplatesOverlay({ templates, onClose, onUse, onSave, onDelete }: Props) {
  const [query, setQuery] = useState('');

  const sortedTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      const aTime = a.lastUsedAt ?? a.createdAt;
      const bTime = b.lastUsedAt ?? b.createdAt;
      return bTime - aTime;
    });
  }, [templates]);

  const filtered = useMemo(() => {
    if (!query.trim()) return sortedTemplates;
    const q = query.toLowerCase();
    return sortedTemplates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.prompt.toLowerCase().includes(q),
    );
  }, [sortedTemplates, query]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-slate-950">
      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
        <span className="flex-1 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
          Prompt Templates
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[11px] font-medium transition-colors"
        >
          Close
        </button>
      </div>

      {templates.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-b border-slate-100 dark:border-slate-800">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            className="w-full px-2.5 py-1.5 text-[12px] border border-slate-200 dark:border-slate-700 rounded-[6px] bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
          />
        </div>
      )}

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-slate-400 dark:text-slate-600 px-8 text-center">
          <BookmarkIcon />
          <p className="text-[12px]">No templates yet. Save a prompt to create one.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 text-slate-400 dark:text-slate-600 px-8 text-center">
          <p className="text-[12px]">No templates match your search.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto log-scroll">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onUse={(t) => { onUse(t); onClose(); }}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
