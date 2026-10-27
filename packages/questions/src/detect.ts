import type { Catalog, CatalogOption, DependencyField, DetectedChoice, Ecosystem, ManifestChange } from './types';

// Pure manifest diff. No I/O and no model calls.
// A package present in either dependency field of before is not new.

const NPM_FIELDS = ['dependencies', 'devDependencies'] as const;
type NpmField = (typeof NPM_FIELDS)[number];
type Added = { name: string; field: DependencyField };

export function detectChoices(change: ManifestChange, catalog: Catalog): DetectedChoice[] {
  const rows = change.kind === 'package.json' ? addedNpm(change) : addedRequirements(change);
  const ecosystem: Ecosystem = change.kind === 'package.json' ? 'npm' : 'pypi';
  const seen = new Set<string>();
  const choices: DetectedChoice[] = [];
  for (const row of rows) {
    const option = findOption(catalog, ecosystem, row.name);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    choices.push(toChoice(change, option, row, catalog));
  }
  return choices;
}

function toChoice(change: ManifestChange, option: CatalogOption, row: Added, catalog: Catalog): DetectedChoice {
  return {
    option_id: option.id,
    option_name: option.name,
    category: option.category,
    category_label: catalog.categories[option.category],
    package: row.name,
    field: row.field,
    manifest_path: change.path,
    evidence_event_ids: change.event_ids,
  };
}

function findOption(catalog: Catalog, ecosystem: Ecosystem, name: string): CatalogOption | undefined {
  return catalog.options.find((option) => (option.packages[ecosystem] ?? []).includes(name));
}

function addedNpm(change: ManifestChange): Added[] {
  const before = new Set(change.before === null ? [] : npmRows(change.before, change.path).map((row) => row.name));
  return firstNew(npmRows(change.after, change.path), before);
}

function npmRows(text: string, path: string): Added[] {
  const parsed = parsePackageJson(text, path);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const root = parsed as Record<string, unknown>;
  const rows: Added[] = [];
  for (const key of Object.keys(root)) {
    if (!isNpmField(key)) continue;
    const body = root[key];
    if (body === null || typeof body !== 'object' || Array.isArray(body)) continue;
    for (const [name, spec] of Object.entries(body as Record<string, unknown>)) rows.push({ name: aliasTarget(name, spec), field: key });
  }
  return rows;
}

// "foo": "npm:react@19" installs react, so match the alias target, not the key.
function aliasTarget(name: string, spec: unknown): string {
  if (typeof spec !== 'string' || !spec.startsWith('npm:')) return name;
  const target = spec.slice(4), at = target.indexOf('@', 1);
  return at === -1 ? target : target.slice(0, at);
}

function isNpmField(key: string): key is NpmField {
  return (NPM_FIELDS as readonly string[]).includes(key);
}

function parsePackageJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed package.json at ${path}: ${detail}`, { cause: error });
  }
}

function addedRequirements(change: ManifestChange): Added[] {
  const before = new Set(change.before === null ? [] : requirementNames(change.before));
  const rows = requirementNames(change.after).map((name) => ({ name, field: 'requirements' as const }));
  return firstNew(rows, before);
}

function requirementNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = requirementName(line);
    if (name) names.push(name);
  }
  return names;
}

function requirementName(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  if (trimmed.startsWith('-')) return null;
  const match = /^[^[\[\s;=<>!~@\\]+/.exec(trimmed);
  if (!match) return null;
  return pep503(match[0]);
}

// PEP 503: lowercase, and collapse runs of -, _, . into one -.
function pep503(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function firstNew(rows: readonly Added[], before: ReadonlySet<string>): Added[] {
  const seen = new Set<string>();
  const added: Added[] = [];
  for (const row of rows) {
    if (before.has(row.name) || seen.has(row.name)) continue;
    seen.add(row.name);
    added.push(row);
  }
  return added;
}
