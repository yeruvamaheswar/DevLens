import { describe, expect, it } from 'vitest';
import { askChoices, peersFor, questionText, recordAnswer } from '../src/ask';
import type { AskState, Catalog, DetectedChoice } from '../src/types';

const catalog: Catalog = {
  version: 'test',
  categories: {
    ui_framework: 'UI framework', meta_framework: 'Meta-framework', python_web_framework: 'Python web framework',
    node_web_framework: 'Node web framework', database: 'Database', orm: 'ORM',
    test_framework: 'Test framework', state_management: 'State management',
  },
  options: [
    { id: 'react', name: 'React', category: 'ui_framework', packages: { npm: ['react', 'react-dom'] } },
    { id: 'vue', name: 'Vue', category: 'ui_framework', packages: { npm: ['vue'] } },
    { id: 'angular', name: 'Angular', category: 'ui_framework', packages: { npm: ['@angular/core'] } },
    { id: 'svelte', name: 'Svelte', category: 'ui_framework', packages: { npm: ['svelte'] } },
    { id: 'vitest', name: 'Vitest', category: 'test_framework', packages: { npm: ['vitest'] } },
    { id: 'jest', name: 'Jest', category: 'test_framework', packages: { npm: ['jest'] } },
    { id: 'sqlite', name: 'SQLite', category: 'database', packages: { npm: ['better-sqlite3'] } },
  ],
};

const choice = (option_id: string, option_name: string, category: DetectedChoice['category'], category_label: string, pkg: string): DetectedChoice => ({
  option_id, option_name, category, category_label, package: pkg,
  field: 'dependencies', manifest_path: 'package.json', evidence_event_ids: ['e1', 'e2'],
});
const react = choice('react', 'React', 'ui_framework', 'UI framework', 'react');
const reactDom = choice('react', 'React', 'ui_framework', 'UI framework', 'react-dom');
const vue = choice('vue', 'Vue', 'ui_framework', 'UI framework', 'vue');
const vitest = choice('vitest', 'Vitest', 'test_framework', 'Test framework', 'vitest');
const empty: AskState = { session_id: 's1', asked_option_ids: [], asked_categories: [] };

describe('questionText', () => {
  it('matches the React example exactly', () => {
    expect(questionText(react, ['Vue', 'Angular'])).toBe(
      'You added `react` for the UI framework. Why React? Which alternatives did you consider, for example Vue or Angular?');
  });
  it('lowercases only a first letter followed by a lowercase letter', () => {
    expect(questionText(vitest, ['Jest'])).toContain('for the test framework.');
    expect(questionText(choice('sqlite', 'SQLite', 'database', 'Database', 'better-sqlite3'), [])).toContain('for the database.');
  });
  it('words one peer and zero peers', () => {
    expect(questionText(react, ['Vue'])).toBe(
      'You added `react` for the UI framework. Why React? Which alternatives did you consider, for example Vue?');
    expect(questionText(react, [])).toBe(
      'You added `react` for the UI framework. Why React? Which alternatives did you consider?');
  });
  it('uses none of the judging words', () => {
    const text = askChoices(empty, [react, vitest], catalog).questions.map((q) => q.text).join(' ').toLowerCase();
    for (const word of ['score', 'rank', 'better', 'worse', 'should', 'hire', 'wrong']) expect(text).not.toContain(word);
  });
});

describe('peersFor', () => {
  it('returns up to 2 same-category options in catalog order, excluding the chosen one', () => {
    expect(peersFor('react', catalog)).toEqual(['Vue', 'Angular']);
    expect(peersFor('angular', catalog)).toEqual(['React', 'Vue']);
  });
  it('never crosses categories', () => {
    expect(peersFor('vitest', catalog)).toEqual(['Jest']);
    expect(peersFor('sqlite', catalog)).toEqual([]);
  });
  it('returns nothing for an unknown option', () => {
    expect(peersFor('nope', catalog)).toEqual([]);
  });
});

describe('askChoices', () => {
  it('builds the question with id, rule id, peers, and copied evidence', () => {
    const { questions, state } = askChoices(empty, [react], catalog);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      id: 's1:choice:react', rule_id: 'C1.choice.v1', option_id: 'react', category: 'ui_framework',
      peers: ['Vue', 'Angular'], evidence_event_ids: ['e1', 'e2'],
      text: 'You added `react` for the UI framework. Why React? Which alternatives did you consider, for example Vue or Angular?',
    });
    expect(state.asked_option_ids).toEqual(['react']);
    expect(state.asked_categories).toEqual(['ui_framework']);
  });
  it('asks nothing for react-dom mapped to react in a later call', () => {
    const first = askChoices(empty, [react], catalog);
    expect(askChoices(first.state, [reactDom], catalog).questions).toEqual([]);
  });
  it('asks nothing for a second option in an asked category', () => {
    const first = askChoices(empty, [react], catalog);
    expect(askChoices(first.state, [vue], catalog).questions).toEqual([]);
  });
  it('dedupes inside one call', () => {
    expect(askChoices(empty, [react, reactDom, vue], catalog).questions).toHaveLength(1);
  });
  it('keeps the first choice of a category inside one call, in input order', () => {
    const { questions, state } = askChoices(empty, [vue, react], catalog);
    expect(questions.map((q) => q.id)).toEqual(['s1:choice:vue']);
    expect(questions[0].peers).toEqual(['React', 'Angular']);
    expect(state.asked_option_ids).toEqual(['vue']);
  });
  it('asks a test framework choice after a UI framework choice', () => {
    const first = askChoices(empty, [react], catalog);
    const second = askChoices(first.state, [vitest], catalog);
    expect(second.questions.map((q) => q.id)).toEqual(['s1:choice:vitest']);
  });
  it('does not mutate the input state', () => {
    const state: AskState = { session_id: 's1', asked_option_ids: ['vue'], asked_categories: ['ui_framework'] };
    const snapshot = structuredClone(state);
    const out = askChoices(state, [vitest], catalog);
    expect(state).toEqual(snapshot);
    expect(out.state).not.toBe(state);
    expect(out.state.asked_option_ids).toEqual(['vue', 'vitest']);
  });
});

describe('recordAnswer', () => {
  const question = askChoices(empty, [react], catalog).questions[0];
  it('keeps the text verbatim, including whitespace', () => {
    const text = '  Familiar with it.\n\n  Did not try Vue.  ';
    expect(recordAnswer(question, text, '2026-10-27T10:00:00.000Z', 'live')).toEqual({
      question_id: 's1:choice:react', text, answered_at: '2026-10-27T10:00:00.000Z', delivery: 'live', actor: 'developer',
    });
  });
  it('records post-session delivery', () => {
    expect(recordAnswer(question, 'x', '2026-10-27T10:00:00Z', 'post_session').delivery).toBe('post_session');
  });
  it('throws on a bad timestamp', () => {
    for (const bad of ['', 'yesterday', '2026-13-45T00:00:00Z', '2026-10-27', '2026-02-30T00:00:00Z', '2026-04-31T12:00:00+02:00']) {
      expect(() => recordAnswer(question, 'x', bad, 'live')).toThrow();
    }
  });
});
