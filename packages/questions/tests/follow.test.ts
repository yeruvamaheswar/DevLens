import { describe, expect, it } from 'vitest';
import { extractTerms, followUpQuestion, matchTerm } from '../src/follow';
import type { ChoiceQuestion, DiffFile } from '../src/types';

const parent: ChoiceQuestion = {
  id: 's1:choice:react', rule_id: 'C1.choice.v1', text: 'q', option_id: 'react', category: 'ui_framework' as ChoiceQuestion['category'],
  peers: [], evidence_event_ids: ['e1', 'e2'],
};

describe('extractTerms', () => {
  it('takes backticked spans, trimmed and non-empty', () => {
    expect(extractTerms('I used ` Foo ` and `bar` but not ``.')).toEqual(['Foo', 'bar']);
  });
  it('takes identifier-like bare tokens', () => {
    expect(extractTerms('snake_case a.b.c src/db.ts my-lib parse() useState UserService')).toEqual(
      ['snake_case', 'a.b.c', 'src/db.ts', 'my-lib', 'parse', 'useState', 'UserService']);
  });
  it('ignores plain words', () => {
    expect(extractTerms('I picked React Because it is faster than Vue')).toEqual([]);
  });
  it('strips trailing punctuation', () => {
    expect(extractTerms('Used db_pool, then user_id; also getData()!')).toEqual(['db_pool', 'user_id', 'getData']);
  });
  it('dedupes in first-appearance order, case-sensitive', () => {
    expect(extractTerms('`foo_bar` x foo_bar `Foo_bar` a_b a_b')).toEqual(['foo_bar', 'Foo_bar', 'a_b']);
  });
  it('keeps order across backticked and bare terms', () => {
    expect(extractTerms('first_one then `second` then third_one')).toEqual(['first_one', 'second', 'third_one']);
  });
});

describe('matchTerm', () => {
  const files: DiffFile[] = [
    { file: 'a.ts', added: ['const x = useStateful();'] },
    { file: 'b.ts', added: ["import x from './db.ts'", 'const [a] = useState(0);'] },
  ];
  it('matches whole tokens only', () => {
    expect(matchTerm(['useState'], [files[0]])).toBeNull();
    expect(matchTerm(['useState'], files)).toEqual({ term: 'useState', file: 'b.ts' });
  });
  it('matches a dotted term inside a path string', () => {
    expect(matchTerm(['db.ts'], files)).toEqual({ term: 'db.ts', file: 'b.ts' });
  });
  it('searches files in given order and terms in terms order', () => {
    const both: DiffFile[] = [{ file: 'one.ts', added: ['foo_x bar_x'] }, { file: 'two.ts', added: ['foo_x'] }];
    expect(matchTerm(['foo_x'], both)).toEqual({ term: 'foo_x', file: 'one.ts' });
    expect(matchTerm(['bar_x', 'foo_x'], both)?.term).toBe('bar_x');
  });
  it('returns null when nothing matches', () => {
    expect(matchTerm(['nope_x'], files)).toBeNull();
    expect(matchTerm([], files)).toBeNull();
  });
});

describe('followUpQuestion', () => {
  const q = followUpQuestion(parent, 'db.ts', 'src/app.ts', ['e2', 'e3']);
  it('builds the exact text, id, and rule', () => {
    expect(q.id).toBe('s1:choice:react:follow');
    expect(q.rule_id).toBe('C2.follow_up.v1');
    expect(q.text).toBe('You named `db.ts`. A later change edits `db.ts` in src/app.ts. How does that change relate to your answer?');
    expect(q).toMatchObject({ parent_id: parent.id, term: 'db.ts', file: 'src/app.ts' });
  });
  it('orders and dedupes evidence ids', () => {
    expect(q.evidence_event_ids).toEqual(['e1', 'e2', 'e3']);
  });
  it('stays neutral', () => {
    expect(q.text).not.toMatch(/score|rank|better|worse|should|hire|wrong|fix/i);
  });
});

describe('extractTerms abbreviations', () => {
  it('drops e.g., i.e., and a.k.a. but keeps short dotted code names', () => {
    expect(extractTerms('e.g. this, i.e. that, a.k.a. other; see db.ts and os.path')).toEqual(['db.ts', 'os.path']);
  });
});

describe('matchTerm continued names (c2-review finding 2)', () => {
  const at = (line: string, term: string) => matchTerm([term], [{ file: 'f.ts', added: [line] }]);
  it('does not match a name that continues with a dot or dash', () => {
    expect(at('os.path.join(a, b)', 'os.path')).toBeNull();
    expect(at('import x from "my-lib-extra"', 'my-lib')).toBeNull();
    expect(at('cp db.ts.bak out', 'db.ts')).toBeNull();
    expect(at('x.os.path', 'os.path')).toBeNull();
  });
  it('still matches at a sentence end or inside quotes and paths', () => {
    expect(at('see os.path.', 'os.path')).toEqual({ term: 'os.path', file: 'f.ts' });
    expect(at("import d from './db.ts'", 'db.ts')).toEqual({ term: 'db.ts', file: 'f.ts' });
    expect(at('"my-lib": "1"', 'my-lib')).toEqual({ term: 'my-lib', file: 'f.ts' });
  });
});
