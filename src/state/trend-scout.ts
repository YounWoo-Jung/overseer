import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendAssist, appendHistory } from './history-store.js';

interface TrendInput {
  dependencies: string[];
  scripts: string[];
}

interface TrendItem {
  title: string;
  url?: string;
  summary: string;
}

function pickTopics(input: TrendInput): string[] {
  const deps = new Set(input.dependencies);
  const topics: string[] = [];
  if (deps.has('typescript')) topics.push('TypeScript Node.js best practices 2026');
  if (deps.has('react') || deps.has('ink')) topics.push('React Ink CLI TUI best practices');
  if (deps.has('vitest')) topics.push('Vitest TypeScript testing best practices');
  if (input.scripts.includes('typecheck')) topics.push('TypeScript strict typecheck common pitfalls');
  return topics.length ? topics.slice(0, 3) : ['AI coding agent TypeScript project best practices 2026'];
}

async function searchTopic(topic: string): Promise<TrendItem[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_html=1&skip_disambig=1`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return [];
    const data = await response.json() as {
      AbstractText?: string;
      AbstractURL?: string;
      Heading?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string }[];
    };
    const items: TrendItem[] = [];
    if (data.AbstractText) {
      items.push({ title: data.Heading || topic, url: data.AbstractURL, summary: data.AbstractText.slice(0, 300) });
    }
    for (const item of data.RelatedTopics ?? []) {
      if (item.Text) items.push({ title: item.Text.split(' - ')[0].slice(0, 80), url: item.FirstURL, summary: item.Text.slice(0, 300) });
    }
    return items.slice(0, 3);
  } catch {
    return [];
  }
}

function fallbackItems(input: TrendInput): TrendItem[] {
  return [
    {
      title: 'Project-local TypeScript agent practice',
      summary: [
        'Keep agent actions small and observable.',
        input.scripts.includes('typecheck') ? 'Use typecheck as the first validation gate.' : 'Prefer the fastest available validation gate.',
        'Store repeated failures as reusable project rules.',
      ].join(' '),
    },
  ];
}

export async function refreshTrendSkill(projectDir: string, input: TrendInput): Promise<boolean> {
  const topics = pickTopics(input);
  const found = (await Promise.all(topics.map(searchTopic))).flat();
  const items = found.length ? found : fallbackItems(input);
  const path = join(projectDir, 'skills', 'auto_project_trends.md');
  mkdirSync(dirname(path), { recursive: true });

  const lines = [
    '# Auto Skill: Project Trends',
    '',
    '## When to use',
    '- Background assistant reviews project changes or proposes validation steps.',
    '',
    '## Current project signals',
    `- Dependencies: ${input.dependencies.slice(0, 20).join(', ') || 'none detected'}`,
    `- Scripts: ${input.scripts.join(', ') || 'none detected'}`,
    '',
    '## Trend notes',
    ...items.map((item) => `- ${item.title}: ${item.summary}${item.url ? ` (${item.url})` : ''}`),
    '',
    '## Procedure',
    '- Prefer project-local conventions over generic advice.',
    '- Suggest checks before suggesting edits.',
    '- Convert repeated successful advice into smaller dedicated skills.',
    '',
  ];

  const next = `${lines.join('\n')}\n`;
  if (existsSync(path)) {
    writeFileSync(path, next);
  } else {
    writeFileSync(path, next);
  }

  appendHistory(projectDir, {
    kind: found.length ? 'trend' : 'skill',
    title: 'Project trend skill refreshed',
    detail: found.length ? `Updated from ${found.length} search snippets.` : 'Updated from local project signals.',
    files: ['skills/auto_project_trends.md'],
  });
  appendAssist(projectDir, 'trend skill refreshed', [
    found.length ? `Updated from ${found.length} search snippets.` : 'Search unavailable; used local project signals.',
    'Skill file: skills/auto_project_trends.md',
  ]);
  return true;
}
