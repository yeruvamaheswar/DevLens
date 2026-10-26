const REDACTED = '[REDACTED]';
const MIN_SECRET_LENGTH = 8;
const MIN_SHORT_SECRET_LENGTH = 4;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

// Only these fields hold free text. Short env secrets are stripped only here,
// so ids, ts, type and other structural fields are never rewritten.
const FREE_TEXT_KEYS = new Set(['prompt', 'command', 'stdout', 'stderr', 'error', 'output', 'diff', 'last_assistant_message']);

const DENYLIST = [
  /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]+/g,
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/=]+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}/g,
];

const VALUE = String.raw`("[^"\n]*"|'[^'\n]*'|[^\s"',;&]+)`;
// Redact only the value. Keep the name and separator so the line stays readable.
const ASSIGNMENTS = [
  // NAME=value, NAME: value, "NAME":"value" where NAME looks secret.
  new RegExp(String.raw`(?<![A-Za-z0-9_])((?:SUPABASE_|ANTHROPIC_)[A-Za-z0-9_]*|[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)(["']?\s*[=:]\s*)${VALUE}`, 'g'),
  // apikey=, api_key=, access_token= in any case, including URL queries.
  new RegExp(String.raw`(?<![A-Za-z0-9_])(api_?key|access_?token)(["']?\s*[=:]\s*)${VALUE}`, 'gi'),
];
const AUTH_HEADER = /(\bAuthorization["']?\s*:\s*)[^\r\n]+/gi;

function isSecretName(name: string): boolean {
  return name.startsWith('SUPABASE_') || name.startsWith('ANTHROPIC_') || name.includes('KEY') || name.includes('TOKEN') || name.includes('SECRET') || name.includes('PASSWORD');
}

function envValues(env: Record<string, string | undefined>, min: number, max: number): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value.length < min || value.length > max) continue;
    if (!isSecretName(name)) continue;
    values.push(value);
  }
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

export function secretValuesFromEnv(env: Record<string, string | undefined>): string[] {
  return envValues(env, MIN_SECRET_LENGTH, Infinity);
}

export function shortSecretValuesFromEnv(env: Record<string, string | undefined>): string[] {
  return envValues(env, MIN_SHORT_SECRET_LENGTH, MIN_SECRET_LENGTH - 1);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactString(input: string, secrets: readonly string[], shortSecrets: readonly string[] = []): string {
  let text = input.replace(ZERO_WIDTH, '');
  for (const secret of secrets) {
    if (secret.length === 0 || !text.includes(secret)) continue;
    text = text.split(secret).join(REDACTED);
  }
  for (const secret of shortSecrets) {
    if (secret.length === 0 || !text.includes(secret)) continue;
    text = text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(secret)}(?![A-Za-z0-9])`, 'g'), REDACTED);
  }
  for (const pattern of DENYLIST) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, REDACTED);
  }
  for (const pattern of ASSIGNMENTS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`);
  }
  AUTH_HEADER.lastIndex = 0;
  return text.replace(AUTH_HEADER, (_match, head: string) => `${head}${REDACTED}`);
}

function redactInner(value: unknown, secrets: readonly string[], shortSecrets: readonly string[], freeText: boolean): unknown {
  if (typeof value === 'string') return redactString(value, secrets, freeText ? shortSecrets : []);
  if (Array.isArray(value)) return value.map((item) => redactInner(item, secrets, shortSecrets, freeText));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[redactString(key, secrets)] = redactInner(item, secrets, shortSecrets, FREE_TEXT_KEYS.has(key));
    }
    return out;
  }
  return value;
}

export function redactValue<T>(value: T, secrets: readonly string[], shortSecrets: readonly string[] = []): T {
  return redactInner(value, secrets, shortSecrets, false) as T;
}

// A secret can be cut in two: the head ends stdout and the tail starts stderr
// (or the reverse). Join the two streams, find matches that cross the cut, and
// mask both sides of the cut. Limit: only a secret that is split exactly at the
// stream boundary is found. A secret split across more than two fields, or with
// other text between the parts, is not found.
export function redactStreamPair(first: string, second: string, secrets: readonly string[], shortSecrets: readonly string[] = []): [string, string] {
  const joined = first + second;
  const cut = first.length;
  const spans: [number, number][] = [];
  for (const secret of [...secrets, ...shortSecrets]) {
    if (secret.length === 0) continue;
    for (let at = joined.indexOf(secret); at !== -1; at = joined.indexOf(secret, at + 1)) spans.push([at, at + secret.length]);
  }
  for (const pattern of [...DENYLIST, ...ASSIGNMENTS]) {
    for (const match of joined.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const at = match.index ?? 0;
      spans.push([at, at + match[0].length]);
    }
  }
  let head = first;
  let tail = second;
  for (const [start, end] of spans) {
    if (start >= cut || end <= cut) continue;
    head = head.slice(0, Math.min(head.length, start)) + REDACTED;
    tail = REDACTED + tail.slice(Math.max(0, end - cut));
  }
  return [head, tail];
}
