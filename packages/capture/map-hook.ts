import type { Event, FileEditPayload, TestPayload } from '../core/event';

const TEST_COMMAND = /(^|[\s/])(npm test|vitest|pytest)([\s]|$)/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export type HookInput = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function rawPayload(input: HookInput): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'tool_response' && isRecord(value)) {
      const response: Record<string, unknown> = {};
      for (const [responseKey, responseValue] of Object.entries(value)) {
        if (responseKey === 'originalFile') continue;
        response[responseKey] = responseValue;
      }
      copy[key] = response;
      continue;
    }
    copy[key] = value;
  }
  return copy;
}

function commandOf(input: HookInput): string | null {
  if (!isRecord(input.tool_input)) return null;
  return text(input.tool_input.command);
}

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
}

function filePaths(input: HookInput): string[] {
  if (!isRecord(input.tool_input)) return [];
  const toolInput = input.tool_input;
  const paths: string[] = [];
  const direct = pickString(toolInput, ['file_path', 'filePath', 'path']);
  if (direct) paths.push(direct);
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (!isRecord(edit)) continue;
      const file = pickString(edit, ['file_path', 'filePath', 'path']);
      if (file) paths.push(file);
    }
  }
  return [...new Set(paths)];
}

function hunk(record: Record<string, unknown>): string | null {
  const oldText = pickString(record, ['old_string', 'oldString']);
  const newText = pickString(record, ['new_string', 'newString']);
  const prefixed = (text: string, mark: '+' | '-') => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n').map((line) => `${mark}${line}`).join('\n');
  if (oldText !== null && newText !== null) return `${prefixed(oldText, '-')}\n${prefixed(newText, '+')}`;
  // Write tool: no old text, so every line is an addition.
  const content = pickString(record, ['content']);
  return content !== null && oldText === null && newText === null ? prefixed(content, '+') : null;
}

function editDiff(input: HookInput): string | undefined {
  if (!isRecord(input.tool_input)) return undefined;
  const toolInput = input.tool_input;
  const hunks: string[] = [];
  const direct = hunk(toolInput);
  if (direct) hunks.push(direct);
  if (Array.isArray(toolInput.edits)) {
    for (const edit of toolInput.edits) {
      if (!isRecord(edit)) continue;
      const part = hunk(edit);
      if (part) hunks.push(part);
    }
  }
  if (hunks.length === 0) return undefined;
  const diff = hunks.join('\n');
  if (diff.length > 4000) return undefined;
  return diff;
}

function commandOutput(input: HookInput): string {
  if (typeof input.error === 'string') return input.error;
  if (!isRecord(input.tool_response)) return '';
  const stdout = typeof input.tool_response.stdout === 'string' ? input.tool_response.stdout : '';
  const stderr = typeof input.tool_response.stderr === 'string' ? input.tool_response.stderr : '';
  if (stdout && stderr) return `${stdout}\n${stderr}`;
  return stdout || stderr;
}

export function testStatusFromOutput(output: string): 'passed' | 'failed' | 'unknown' {
  // Rust (cargo test). A compile failure prints no `test result:` line; each test binary prints its own line.
  if (/^error: could not compile /m.test(output) || /^test result: FAILED\b/m.test(output)) return 'failed';
  if (/^error\[E\d{4}\]/m.test(output) && !/^test result: /m.test(output)) return 'failed';
  const nodeFails = [...output.matchAll(/ℹ fail (\d+)/g)].map((match) => Number(match[1]));
  const nodePasses = [...output.matchAll(/ℹ pass (\d+)/g)].map((match) => Number(match[1]));
  if (nodeFails.length > 0 || nodePasses.length > 0) {
    if (nodeFails.some((count) => count > 0) || /^✖ /m.test(output)) return 'failed';
    if (nodeFails.includes(0) && nodePasses.some((count) => count > 0)) return 'passed';
    return 'unknown';
  }
  const failed = [...output.matchAll(/(\d+)\s+failed\b/g)].map((match) => Number(match[1]));
  const passed = [...output.matchAll(/(\d+)\s+passed\b/g)].map((match) => Number(match[1]));
  if (failed.some((count) => count > 0) || /^✖ /m.test(output)) return 'failed';
  if (failed.every((count) => count === 0) && passed.some((count) => count > 0) && !/^✖ /m.test(output)) return 'passed';
  return 'unknown';
}

function baseEvent(input: HookInput, ts: string, projectId: string): Omit<Event, 'id' | 'actor' | 'type' | 'payload'> {
  return {
    session_id: text(input.session_id) ?? 'unknown',
    project_id: projectId,
    ts,
    seq: 0,
    source: 'claude_code_hook',
    provenance: 'observed',
    recording_ref: null,
    media_offset_ms: null,
    tool_use_id: text(input.tool_use_id),
  };
}

function toolEventId(sessionId: string, toolUseId: string | null, phase: 'pre' | 'post'): string {
  return `${sessionId}:${toolUseId ?? 'unknown'}:${phase}`;
}

function namedEventId(sessionId: string, hookEventName: string, promptId: string | null): string {
  return `${sessionId}:${hookEventName}:${promptId ?? 'unknown'}`;
}

function testPayload(input: HookInput, signal: TestPayload['signal'], status: TestPayload['status']): TestPayload & { hook_event_name: string; raw: Record<string, unknown> } {
  const payload: TestPayload & { hook_event_name: string; raw: Record<string, unknown> } = {
    status,
    command: commandOf(input) ?? 'unknown',
    output: commandOutput(input),
    signal,
    hook_event_name: String(input.hook_event_name),
    raw: rawPayload(input),
  };
  const promptId = text(input.prompt_id);
  if (promptId) payload.prompt_id = promptId;
  if (typeof input.duration_ms === 'number') payload.duration_ms = input.duration_ms;
  return payload;
}

export function mapHook(input: HookInput, ts: string, projectId: string): Event | null {
  const hookEventName = text(input.hook_event_name);
  if (!hookEventName || hookEventName === 'SessionStart') return null;
  const shared = baseEvent(input, ts, projectId);
  const promptId = text(input.prompt_id);
  const raw = rawPayload(input);

  if (hookEventName === 'UserPromptSubmit') {
    return {
      ...shared,
      id: namedEventId(shared.session_id, hookEventName, promptId),
      actor: 'developer',
      type: 'prompt',
      payload: {
        hook_event_name: hookEventName,
        prompt_id: promptId,
        prompt: text(input.prompt),
        raw,
      },
    };
  }

  if (hookEventName === 'Stop' || hookEventName === 'SessionEnd') {
    return {
      ...shared,
      id: namedEventId(shared.session_id, hookEventName, promptId),
      actor: 'agent',
      type: 'stop',
      payload: { hook_event_name: hookEventName, prompt_id: promptId, raw },
    };
  }

  if (hookEventName === 'PreToolUse') {
    return {
      ...shared,
      id: toolEventId(shared.session_id, shared.tool_use_id ?? null, 'pre'),
      actor: 'agent',
      type: 'tool_call',
      payload: {
        hook_event_name: hookEventName,
        phase: 'pre',
        tool_name: text(input.tool_name),
        prompt_id: promptId,
        raw,
      },
    };
  }

  if (hookEventName !== 'PostToolUse' && hookEventName !== 'PostToolUseFailure') return null;

  const toolName = text(input.tool_name);
  const command = commandOf(input);
  const failedHook = hookEventName === 'PostToolUseFailure';
  if (command && isTestCommand(command)) {
    const output = commandOutput(input);
    const status = failedHook ? 'failed' : testStatusFromOutput(output);
    const signal = failedHook ? 'hook_failure' : 'output_parse';
    return {
      ...shared,
      id: toolEventId(shared.session_id, shared.tool_use_id ?? null, 'post'),
      actor: 'agent',
      type: 'test',
      payload: testPayload(input, signal, status),
    };
  }

  if (!failedHook && toolName && EDIT_TOOLS.has(toolName)) {
    const filePayload: FileEditPayload & { hook_event_name: string; raw: Record<string, unknown> } = {
      files: filePaths(input),
      tool_name: toolName,
      hook_event_name: hookEventName,
      raw,
    };
    const diff = editDiff(input);
    if (diff) filePayload.diff = diff;
    return {
      ...shared,
      id: toolEventId(shared.session_id, shared.tool_use_id ?? null, 'post'),
      actor: 'agent',
      type: 'file_edit',
      payload: filePayload,
    };
  }

  return {
    ...shared,
    id: toolEventId(shared.session_id, shared.tool_use_id ?? null, 'post'),
    actor: 'agent',
    type: 'tool_call',
    payload: {
      hook_event_name: hookEventName,
      phase: failedHook ? 'failure' : 'post',
      tool_name: toolName,
      prompt_id: promptId,
      raw,
    },
  };
}
