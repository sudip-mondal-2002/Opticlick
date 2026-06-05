import type { SessionExportBundle } from './types';
import {
  formatBytes,
  formatIso,
  groupTurnsIntoSteps,
  isProducedFile,
  shouldEmbedFile,
} from './helpers';

export function exportSessionAsMarkdown(bundle: SessionExportBundle): string {
  const { session } = bundle;
  const startUrl = bundle.startUrl ?? session.startUrl ?? 'Unknown';
  const modelId = bundle.modelId ?? session.modelId ?? 'Unknown';
  const status = session.status ?? 'unknown';
  const lines: string[] = [];

  lines.push('---');
  lines.push(`title: "${escapeYaml(session.title)}"`);
  lines.push(`startUrl: ${startUrl}`);
  lines.push(`model: ${modelId}`);
  lines.push(`created: ${formatIso(session.createdAt)}`);
  lines.push(`updated: ${formatIso(session.updatedAt)}`);
  lines.push(`status: ${status}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${session.title}`);
  lines.push('');
  lines.push(`**Start URL:** ${startUrl}`);
  lines.push(`**Model:** ${modelId}`);
  lines.push(`**Created:** ${formatIso(session.createdAt)}`);
  lines.push(`**Updated:** ${formatIso(session.updatedAt)}`);
  lines.push(`**Status:** ${status}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  if (bundle.summary) {
    lines.push(bundle.summary);
  } else {
    lines.push('_No finish summary — session may still be in progress._');
  }
  lines.push('');

  if (bundle.todo.length > 0) {
    lines.push('## Task Plan');
    lines.push('');
    lines.push('| ID | Title | Status | Notes |');
    lines.push('| --- | --- | --- | --- |');
    for (const item of bundle.todo) {
      const notes = (item.notes ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${item.id} | ${item.title} | ${item.status} | ${notes} |`);
    }
    lines.push('');
  }

  const steps = groupTurnsIntoSteps(bundle.turns, bundle.vfsFiles);
  if (steps.length > 0) {
    lines.push('## Execution Log');
    lines.push('');
    for (const step of steps) {
      lines.push(`### Step ${step.stepNumber}`);
      lines.push('');
      if (step.userContent) {
        lines.push('> ' + step.userContent.replace(/\n/g, '\n> '));
        lines.push('');
      }
      if (step.reasoning) {
        lines.push('<details>');
        lines.push('<summary>Reasoning</summary>');
        lines.push('');
        lines.push(step.reasoning);
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }
      if (step.toolCalls?.length) {
        lines.push('**Actions:**');
        lines.push('');
        for (const tc of step.toolCalls) {
          lines.push('```json');
          lines.push(JSON.stringify({ tool: tc.name, args: tc.args }, null, 2));
          lines.push('```');
          lines.push('');
        }
      }
      if (step.toolResults.length > 0) {
        lines.push('**Results:**');
        lines.push('');
        for (const result of step.toolResults) {
          lines.push('```');
          lines.push(result.content);
          lines.push('```');
          lines.push('');
        }
      }
      if (step.screenshot) {
        if (shouldEmbedFile(step.screenshot)) {
          lines.push(`![Step ${step.stepNumber} screenshot](data:${step.screenshot.mimeType};base64,${step.screenshot.data})`);
        } else {
          lines.push(`_Screenshot \`step_${step.stepNumber}.png\` (${formatBytes(step.screenshot.size)}) exceeds 1 MB — not embedded._`);
        }
        lines.push('');
      }
    }
  }

  const producedFiles = bundle.vfsFiles.filter(isProducedFile);
  lines.push('## Files Produced');
  lines.push('');
  if (producedFiles.length === 0) {
    lines.push('_No user-facing files produced._');
  } else {
    lines.push('| File | Type | Size | Notes |');
    lines.push('| --- | --- | --- | --- |');
    for (const file of producedFiles) {
      const note = shouldEmbedFile(file)
        ? 'Embedded in JSON export'
        : 'Exceeds 1 MB — not embedded; see JSON export metadata';
      lines.push(`| ${file.name} | ${file.mimeType} | ${formatBytes(file.size)} | ${note} |`);
    }
  }
  lines.push('');

  lines.push('## Memory Updates');
  lines.push('');
  if (bundle.memoryUpdates.length === 0) {
    lines.push('_No memory updates during this session._');
  } else {
    for (const update of bundle.memoryUpdates) {
      lines.push(`- **${update.action}** \`${update.key}\` — ${update.content}`);
    }
  }
  lines.push('');

  if (bundle.scratchpad.length > 0) {
    lines.push('## Scratchpad');
    lines.push('');
    for (const note of bundle.scratchpad) {
      lines.push(`### ${note.key}`);
      lines.push('');
      lines.push(note.value);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function escapeYaml(value: string): string {
  return value.replace(/"/g, '\\"');
}
