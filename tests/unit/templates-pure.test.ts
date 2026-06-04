import { describe, it, expect } from 'vitest';
import type { PromptTemplate } from '@/utils/types';

// Helper: Sort templates
function sortTemplates(templates: PromptTemplate[]): PromptTemplate[] {
  return [...templates].sort((a, b) => {
    const aTime = a.lastUsedAt ?? a.createdAt;
    const bTime = b.lastUsedAt ?? b.createdAt;
    return bTime - aTime;
  });
}

// Helper: Fuzzy match templates
function fuzzyMatchTemplates(templates: PromptTemplate[], query: string): PromptTemplate[] {
  if (!query.trim()) return templates;
  const q = query.toLowerCase();
  return templates.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.prompt.toLowerCase().includes(q),
  );
}

// Helper: Enforce 100-template cap
function canAddTemplate(templates: PromptTemplate[]): boolean {
  return templates.length < 100;
}

describe('Templates Sorting', () => {
  it('sorts by lastUsedAt descending', () => {
    const templates: PromptTemplate[] = [
      {
        id: '1',
        name: 'Old',
        prompt: 'test',
        createdAt: 1000,
        lastUsedAt: 1000,
      },
      {
        id: '2',
        name: 'Newer',
        prompt: 'test',
        createdAt: 2000,
        lastUsedAt: 3000,
      },
      {
        id: '3',
        name: 'Newest',
        prompt: 'test',
        createdAt: 3000,
        lastUsedAt: 4000,
      },
    ];

    const sorted = sortTemplates(templates);
    expect(sorted[0].id).toBe('3');
    expect(sorted[1].id).toBe('2');
    expect(sorted[2].id).toBe('1');
  });

  it('falls back to createdAt when lastUsedAt is not set', () => {
    const templates: PromptTemplate[] = [
      { id: '1', name: 'First', prompt: 'test', createdAt: 1000 },
      { id: '2', name: 'Second', prompt: 'test', createdAt: 2000 },
      { id: '3', name: 'Third', prompt: 'test', createdAt: 3000 },
    ];

    const sorted = sortTemplates(templates);
    expect(sorted[0].id).toBe('3');
    expect(sorted[1].id).toBe('2');
    expect(sorted[2].id).toBe('1');
  });

  it('prioritizes lastUsedAt over createdAt', () => {
    const templates: PromptTemplate[] = [
      {
        id: '1',
        name: 'Old but used recently',
        prompt: 'test',
        createdAt: 1000,
        lastUsedAt: 3000,
      },
      {
        id: '2',
        name: 'New but never used',
        prompt: 'test',
        createdAt: 2000,
      },
    ];

    const sorted = sortTemplates(templates);
    expect(sorted[0].id).toBe('1');
    expect(sorted[1].id).toBe('2');
  });
});

describe('Templates Fuzzy Matching', () => {
  const templates: PromptTemplate[] = [
    { id: '1', name: 'Check GitHub', prompt: 'Navigate to GitHub and check notifications', createdAt: 1000 },
    { id: '2', name: 'Write Email', prompt: 'Draft an email response', createdAt: 2000 },
    { id: '3', name: 'Code Review', prompt: 'Review pull requests on GitHub', createdAt: 3000 },
  ];

  it('matches by name substring (case-insensitive)', () => {
    const results = fuzzyMatchTemplates(templates, 'github');
    expect(results).toHaveLength(2);
    expect(results.map((t) => t.id)).toEqual(['1', '3']);
  });

  it('matches by prompt substring', () => {
    const results = fuzzyMatchTemplates(templates, 'email');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('2');
  });

  it('matches case-insensitively', () => {
    const results = fuzzyMatchTemplates(templates, 'GITHUB');
    expect(results).toHaveLength(2);
  });

  it('returns empty array when no match', () => {
    const results = fuzzyMatchTemplates(templates, 'nonexistent');
    expect(results).toEqual([]);
  });

  it('returns all when query is empty', () => {
    const results = fuzzyMatchTemplates(templates, '');
    expect(results).toEqual(templates);
  });

  it('returns all when query is whitespace', () => {
    const results = fuzzyMatchTemplates(templates, '   ');
    expect(results).toEqual(templates);
  });
});

describe('Templates 100-Cap', () => {
  it('allows adding template when under cap', () => {
    const templates: PromptTemplate[] = Array.from({ length: 50 }, (_, i) => ({
      id: `${i}`,
      name: `Template ${i}`,
      prompt: 'test',
      createdAt: 1000 + i,
    }));

    expect(canAddTemplate(templates)).toBe(true);
  });

  it('prevents adding when at 100', () => {
    const templates: PromptTemplate[] = Array.from({ length: 100 }, (_, i) => ({
      id: `${i}`,
      name: `Template ${i}`,
      prompt: 'test',
      createdAt: 1000 + i,
    }));

    expect(canAddTemplate(templates)).toBe(false);
  });

  it('allows adding when just under cap', () => {
    const templates: PromptTemplate[] = Array.from({ length: 99 }, (_, i) => ({
      id: `${i}`,
      name: `Template ${i}`,
      prompt: 'test',
      createdAt: 1000 + i,
    }));

    expect(canAddTemplate(templates)).toBe(true);
  });
});
