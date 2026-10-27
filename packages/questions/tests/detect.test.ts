import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/catalog';
import { detectChoices } from '../src/detect';
import type { Category, ManifestChange } from '../src/types';

function pkg(after: string, before: string | null = null, path = 'package.json'): ManifestChange {
  return { path, kind: 'package.json', before, after, event_ids: ['e1', 'e2'] };
}

function req(after: string, before: string | null = null, path = 'requirements.txt'): ManifestChange {
  return { path, kind: 'requirements.txt', before, after, event_ids: ['e1', 'e2'] };
}

describe('detectChoices', () => {
  it('adding react yields one ui_framework React choice', () => {
    const before = JSON.stringify({ dependencies: { 'left-pad': '1.0.0' } });
    const after = JSON.stringify({ dependencies: { 'left-pad': '1.0.0', react: '19.0.0' } });
    expect(detectChoices(pkg(after, before, 'apps/web/package.json'), CATALOG)).toEqual([{
      option_id: 'react',
      option_name: 'React',
      category: 'ui_framework',
      category_label: 'UI framework',
      package: 'react',
      field: 'dependencies',
      manifest_path: 'apps/web/package.json',
      evidence_event_ids: ['e1', 'e2'],
    }]);
  });

  it('react and react-dom together yield one choice, using the first name in the after file', () => {
    const domFirst = `{
      "dependencies": {
        "react-dom": "19.0.0",
        "react": "19.0.0"
      }
    }`;
    expect(detectChoices(pkg(domFirst), CATALOG)).toMatchObject([
      { option_id: 'react', option_name: 'React', category: 'ui_framework', package: 'react-dom', field: 'dependencies' },
    ]);
    const reactFirst = `{
      "dependencies": {
        "react": "19.0.0",
        "react-dom": "19.0.0"
      }
    }`;
    expect(detectChoices(pkg(reactFirst), CATALOG)).toMatchObject([
      { option_id: 'react', package: 'react' },
    ]);
  });

  it('adding vitest under devDependencies yields a test_framework choice', () => {
    const before = JSON.stringify({ dependencies: { react: '19.0.0' } });
    const after = JSON.stringify({
      dependencies: { react: '19.0.0' },
      devDependencies: { vitest: '5.0.0' },
    });
    expect(detectChoices(pkg(after, before), CATALOG)).toEqual([{
      option_id: 'vitest',
      option_name: 'Vitest',
      category: 'test_framework',
      category_label: 'Test framework',
      package: 'vitest',
      field: 'devDependencies',
      manifest_path: 'package.json',
      evidence_event_ids: ['e1', 'e2'],
    }]);
  });

  it('moving a package from dependencies to devDependencies yields nothing', () => {
    const before = JSON.stringify({ dependencies: { react: '19.0.0' }, devDependencies: {} });
    const after = JSON.stringify({ dependencies: {}, devDependencies: { react: '19.0.0' } });
    expect(detectChoices(pkg(after, before), CATALOG)).toEqual([]);
  });

  it('no new dependency yields nothing', () => {
    const before = JSON.stringify({ dependencies: { react: '18.0.0' } });
    const after = JSON.stringify({ dependencies: { react: '19.0.0' } });
    expect(detectChoices(pkg(after, before), CATALOG)).toEqual([]);
  });

  it('an unknown package yields nothing', () => {
    const after = JSON.stringify({ dependencies: { 'left-pad': '1.0.0' } });
    expect(detectChoices(pkg(after, null, 'apps/new/package.json'), CATALOG)).toEqual([]);
  });

  it('reads a FastAPI requirement with extras, a version, and a marker', () => {
    const after = 'FastAPI[all]>=0.110 ; python_version>"3.9"\n';
    expect(detectChoices(req(after), CATALOG)).toEqual([{
      option_id: 'fastapi',
      option_name: 'FastAPI',
      category: 'python_web_framework',
      category_label: 'Python web framework',
      package: 'fastapi',
      field: 'requirements',
      manifest_path: 'requirements.txt',
      evidence_event_ids: ['e1', 'e2'],
    }]);
  });

  it('normalizes a requirement name and skips a name already in before', () => {
    const before = 'fastapi==0.110\n';
    const after = 'fastapi==0.111\npsycopg2_binary==2.9.9\n';
    expect(detectChoices(req(after, before), CATALOG)).toMatchObject([
      { option_id: 'postgresql', option_name: 'PostgreSQL', package: 'psycopg2-binary', field: 'requirements' },
    ]);
  });

  it('ignores comments, blank lines, and -r, -e, and -- lines', () => {
    const after = [
      '# FastAPI[all]>=0.110',
      '',
      '-r ./dev.txt',
      '-e ./local',
      '--extra-index-url https://pypi.org/simple',
      'flask>=3.0',
    ].join('\n');
    expect(detectChoices(req(after), CATALOG).map((choice) => choice.option_name)).toEqual(['Flask']);
  });

  it('throws on malformed package.json and names the path', () => {
    const path = 'services/api/package.json';
    expect(() => detectChoices(pkg('{', null, path), CATALOG)).toThrow(path);
    expect(() => detectChoices(pkg('{"dependencies":{}}', '{', path), CATALOG)).toThrow(path);
  });
});

describe('detectChoices edge cases (c1a-review)', () => {
  const names = (c: ManifestChange) => detectChoices(c, CATALOG).map((x) => x.package);
  it('reads CRLF lines, inline comments, direct URLs, continuations, and a new file', () => {
    expect(names(req('flask==3.0 # web\r\ndjango @ https://example.com/d.zip\r\n-c constraints.txt\r\n-i https://pypi.example\r\npytest\\\r\n'))).toEqual(['flask', 'django', 'pytest']);
  });
  it('passes event ids through', () => {
    expect(detectChoices(req('fastapi\n'), CATALOG)[0].evidence_event_ids).toEqual(['e1', 'e2']);
  });
  it('counts a package in both dependency fields once', () => {
    expect(names(pkg(JSON.stringify({ dependencies: { jest: '1' }, devDependencies: { jest: '1' } })))).toEqual(['jest']);
  });
  it('matches the target of an npm alias, not its key', () => {
    expect(names(pkg(JSON.stringify({ dependencies: { ui: 'npm:react@19', react: 'npm:preact@10' } })))).toEqual(['react']);
    expect(names(pkg(JSON.stringify({ dependencies: { db: 'npm:@prisma/client@6' } })))).toEqual(['@prisma/client']);
  });
  it('accepts a leading byte-order mark', () => {
    expect(names(pkg('\uFEFF' + JSON.stringify({ dependencies: { mongoose: '8' } })))).toEqual(['mongoose']);
  });
});

describe('CATALOG', () => {
  it('has no duplicate package mapping, and every option category exists', () => {
    expect(CATALOG.version).toBe('2026-10-27.1');
    expect(CATALOG.categories).toEqual({
      ui_framework: 'UI framework',
      meta_framework: 'Meta-framework',
      python_web_framework: 'Python web framework',
      node_web_framework: 'Node web framework',
      database: 'Database',
      orm: 'ORM',
      test_framework: 'Test framework',
      state_management: 'State management',
    });
    expect(CATALOG.options.map((option) => option.name)).toEqual([
      'React', 'Vue', 'Angular', 'Svelte', 'Solid',
      'Next.js', 'Nuxt', 'SvelteKit', 'Remix', 'Astro',
      'FastAPI', 'Flask', 'Django',
      'Express', 'Fastify', 'NestJS', 'Hono',
      'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Supabase',
      'Prisma', 'Drizzle', 'SQLAlchemy', 'TypeORM',
      'Vitest', 'Jest', 'node:test', 'pytest',
      'Redux', 'Zustand', 'Jotai', 'Pinia',
    ]);

    const labels = new Set(Object.keys(CATALOG.categories));
    const byKey = new Map<string, string>();
    const byName = new Map<string, string>();
    const ids = new Set<string>();
    for (const option of CATALOG.options) {
      expect(labels.has(option.category)).toBe(true);
      expect(CATALOG.categories[option.category as Category].length).toBeGreaterThan(0);
      expect(ids.has(option.id)).toBe(false);
      ids.add(option.id);
      for (const ecosystem of ['npm', 'pypi'] as const) {
        for (const name of option.packages[ecosystem] ?? []) {
          expect(name).toBe(name.toLowerCase());
          if (ecosystem === 'pypi') expect(name).toBe(name.replace(/[-_.]+/g, '-'));
          const key = `${ecosystem}:${name}`;
          expect(byKey.has(key)).toBe(false);
          byKey.set(key, option.id);
          const previous = byName.get(name);
          expect(previous === undefined || previous === option.id).toBe(true);
          byName.set(name, option.id);
        }
      }
    }
    expect(new Set(CATALOG.options.map((option) => option.category))).toEqual(labels);
    expect(CATALOG.options.find((option) => option.id === 'node-test')?.packages).toEqual({});
  });
});
