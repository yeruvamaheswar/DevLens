import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import type { Event, FileEditPayload } from '../../core/event';
import { askChoices } from './ask';
import { CATALOG } from './catalog';
import { detectChoices } from './detect';
import type { AskState, Catalog, DetectedChoice, DiffFile, LiveInput, ManifestChange, ManifestKind } from './types';

// Rules plus read-only I/O behind ManifestReader. Turns captured hook events into LiveInput values.
// Not wired into the app or the capture hook. No model. State in, new state out. Input state is never mutated.

export type ManifestReader = {
  atHead(path: string): string | null; // content at git HEAD; null if HEAD lacks the file, the repo has no commits, or the path is outside the repo
  now(path: string): string | null;    // working-tree content; null if deleted or outside the repo
};
export type AdapterState = {
  ask: AskState;                     // askChoices dedupe state
  pending: Event[];                  // file_edit events since the last stop
  snapshots: Record<string, string>; // manifest path -> content seen at the previous stop
};

export function startAdapter(session_id: string): AdapterState {
  return { ask: { session_id, asked_option_ids: [], asked_categories: [] }, pending: [], snapshots: {} };
}

const MANIFEST_KINDS: Record<string, ManifestKind> = { 'package.json': 'package.json', 'requirements.txt': 'requirements.txt' };
// Own-property checks: a file named `constructor` or `__proto__` must not hit inherited members.
const manifestKind = (file: string): ManifestKind | null => {
  const name = path.basename(file);
  return Object.hasOwn(MANIFEST_KINDS, name) ? MANIFEST_KINDS[name] : null;
};
const filesOf = (event: Event): string[] => ((event.payload as Partial<FileEditPayload>).files ?? []).filter((f) => typeof f === 'string');
const diffOf = (event: Event): string | null => {
  const diff = (event.payload as Partial<FileEditPayload>).diff;
  return typeof diff === 'string' && diff.length > 0 ? diff : null;
};

// map-hook builds a diff as "- old\n+ new" hunks. Keep lines that start with '+' (not '+++') and drop that '+'.
function addedLines(diff: string): string[] {
  return diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1));
}

// Multi-file rule: the diff text does not say which lines belong to which file, so every file the
// edit names gets all of the edit's added lines (over-attribute, never drop). Edits to one file merge.
function diffFiles(edits: Event[]): DiffFile[] {
  const byFile = new Map<string, string[]>();
  for (const edit of edits) {
    const diff = diffOf(edit);
    if (diff === null) continue;
    const added = addedLines(diff);
    for (const file of filesOf(edit)) byFile.set(file, [...(byFile.get(file) ?? []), ...added]);
  }
  return [...byFile].map(([file, added]) => ({ file, added }));
}

function flush(state: AdapterState, at_ms: number, reader: ManifestReader, catalog: Catalog): { state: AdapterState; inputs: LiveInput[] } {
  const inputs: LiveInput[] = [];
  const edits = state.pending;

  const withDiff = edits.filter((e) => diffOf(e) !== null && filesOf(e).length > 0);
  const files = diffFiles(edits);
  if (files.length > 0) inputs.push({ kind: 'diff', files, event_ids: withDiff.map((e) => e.id), at_ms });

  const snapshots = { ...state.snapshots };
  const choices: DetectedChoice[] = [];
  const manifests = [...new Set(edits.flatMap(filesOf).filter((f) => manifestKind(f) !== null))];
  for (const file of manifests) {
    const after = reader.now(file);
    if (after === null) continue;
    const before = Object.hasOwn(snapshots, file) ? snapshots[file] : reader.atHead(file);
    // Save what we saw even when nothing changed, so the next Stop compares with this Stop, not a moved HEAD.
    Object.defineProperty(snapshots, file, { value: after, enumerable: true, writable: true, configurable: true });
    if (before === after) continue;
    const change: ManifestChange = {
      path: file, kind: manifestKind(file)!, before, after,
      event_ids: edits.filter((e) => filesOf(e).includes(file)).map((e) => e.id),
    };
    choices.push(...detectChoices(change, catalog));
  }
  const asked = askChoices(state.ask, choices, catalog);
  if (asked.questions.length > 0) inputs.push({ kind: 'questions', questions: asked.questions, at_ms });
  return { state: { ask: asked.state, pending: [], snapshots }, inputs };
}

export function adapt(state: AdapterState, event: Event, reader: ManifestReader, catalog: Catalog = CATALOG): { state: AdapterState; inputs: LiveInput[] } {
  if (event.type === 'file_edit') return { state: { ...state, pending: [...state.pending, event] }, inputs: [] };
  if (event.type !== 'stop') return { state, inputs: [] };
  const at_ms = Date.parse(event.ts);
  // map-hook turns both Stop and SessionEnd into type 'stop'; payload.hook_event_name tells them apart.
  const ended = event.payload.hook_event_name === 'SessionEnd';
  const flushed = flush(state, at_ms, reader, catalog);
  flushed.inputs.push(ended ? { kind: 'session_end', at_ms } : { kind: 'stop', at_ms, event_id: event.id });
  return flushed;
}

// ---- git-backed reader ----

function canonical(p: string): string {
  try { return realpathSync(p); } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(canonical(parent), path.basename(p));
  }
}

const NOT_IN_HEAD = [/does not exist in 'HEAD'/, /exists on disk, but not in 'HEAD'/, /invalid object name 'HEAD'/, /unknown revision or path not in the working tree/];

export function gitManifestReader(projectDir: string): ManifestReader {
  let root: string;
  try {
    root = canonical(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
  } catch (error) {
    throw new Error(`gitManifestReader: ${projectDir} is not inside a git repository (${(error as Error).message.split('\n')[0]})`);
  }
  const relative = (file: string): string | null => {
    const rel = path.relative(root, canonical(path.resolve(root, file)));
    return rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? null : rel;
  };
  return {
    atHead(file) {
      const rel = relative(file);
      if (rel === null) return null;
      try {
        return execFileSync('git', ['show', `HEAD:${rel.split(path.sep).join('/')}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
      } catch (error) {
        const stderr = String((error as { stderr?: unknown }).stderr ?? '');
        if (NOT_IN_HEAD.some((pattern) => pattern.test(stderr))) return null;
        throw error;
      }
    },
    now(file) {
      const rel = relative(file);
      if (rel === null) return null;
      try {
        return readFileSync(path.join(root, rel), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
