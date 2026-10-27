import { describe, expect, it } from 'vitest';
import { askChoices } from '../src/ask';
import { CATALOG } from '../src/catalog';
import { detectChoices } from '../src/detect';
import type { AskState, ManifestChange } from '../src/types';

// C1 acceptance (plans/devlens-review-questions.md, Phases row C1) on the real catalog.
const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: 'app', dependencies: deps, devDependencies: dev });
const change = (before: string | null, after: string, id: string): ManifestChange =>
  ({ path: 'package.json', kind: 'package.json', before, after, event_ids: [id] });
const empty: AskState = { session_id: 's1', asked_option_ids: [], asked_categories: [] };
const run = (state: AskState, c: ManifestChange) => askChoices(state, detectChoices(c, CATALOG), CATALOG);

describe('C1 pipeline on the real catalog', () => {
  it('adding react asks one question naming Vue and Angular', () => {
    const { questions } = run(empty, change(pkg({}), pkg({ react: '^19' }), 'e1'));
    expect(questions.map((q) => q.text)).toEqual([
      'You added `react` for the UI framework. Why React? Which alternatives did you consider, for example Vue or Angular?',
    ]);
    expect(questions[0].evidence_event_ids).toEqual(['e1']);
  });
  it('adding react-dom after react asks nothing', () => {
    const first = run(empty, change(pkg({}), pkg({ react: '^19' }), 'e1'));
    expect(run(first.state, change(pkg({ react: '^19' }), pkg({ react: '^19', 'react-dom': '^19' }), 'e2')).questions).toEqual([]);
  });
  it('adding a devDependencies test tool asks the test-framework question', () => {
    const { questions } = run(empty, change(pkg({}), pkg({}, { vitest: '^5' }), 'e3'));
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ option_id: 'vitest', category: 'test_framework' });
    expect(questions[0].text).toMatch(/^You added `vitest` for the test framework\. Why Vitest\? /);
  });
  it('no new dependency asks nothing (negative control)', () => {
    const same = pkg({ react: '^19' }, { vitest: '^5' });
    expect(run(empty, change(same, same.replace('"app"', '"renamed"'), 'e4')).questions).toEqual([]);
  });
  it('every question peer comes from the same category', () => {
    for (const option of CATALOG.options) {
      const { questions } = askChoices(empty, [{
        option_id: option.id, option_name: option.name, category: option.category,
        category_label: CATALOG.categories[option.category], package: option.id,
        field: 'dependencies', manifest_path: 'package.json', evidence_event_ids: [],
      }], CATALOG);
      const sameCategory = CATALOG.options.filter((o) => o.category === option.category).map((o) => o.name);
      for (const peer of questions[0].peers) expect(sameCategory).toContain(peer);
      expect(questions[0].peers).not.toContain(option.name);
    }
  });
});
