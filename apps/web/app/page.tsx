import { readFile } from 'node:fs/promises';
import { loadGoldenExtras } from '../../../packages/core/fixture';
import { goldenFile, localGoldenReplay } from '../../../packages/core/server';
import { compileReplay, lineLayout } from '../replay/compile';
import { buildReplayView } from '../replay/view';
import { TransitLine } from '../ui/line';
import { TopBar } from '../ui/topbar';

// The motif is drawn from the local golden files, the same events the replay uses.
async function goldenMotif() {
  const view = buildReplayView(await localGoldenReplay(), await readFile(goldenFile('git-diffs.patch'), 'utf8'), await loadGoldenExtras());
  const compiled = compileReplay(view);
  const count = (kind: string) => compiled.summary.find((item) => item.key === kind)?.value ?? '0';
  return {
    label: view.label,
    layout: lineLayout(compiled.stations, { compact: true }),
    caption: `${view.label}: ${count('sessions')} sessions, ${count('tests')} session test runs, ${count('failed')} failed, ${count('passed')} passed, separate re-run ${count('rerun')}.`,
    notCaptured: view.not_captured,
  };
}

export default async function Home() {
  const motif = await goldenMotif();
  return (
    <>
      <TopBar place="home" />
      <main id="main" className="page home">
        <section className="home-hero" aria-labelledby="home-title">
          <h1 id="home-title">Evidence from a recorded coding session.</h1>
          <p>
            DevLens replays a consented Claude Code session as a line of events: what the agent did, what the tests said, and what the developer answered.
          </p>
          <div className="home-actions">
            <a className="btn btn--primary" href="/replay">Open the golden replay</a>
            <a className="btn" href="/record">Record a window</a>
          </div>
        </section>

        <figure className="home-motif">
          <div className="motif-scroll">
            <TransitLine layout={motif.layout} label={`The ${motif.label} as a line of events.`} compact />
          </div>
          <figcaption>{motif.caption} Crossed red rings are failed tests. The ticked green disc is the pass. The amber square is the separate re-run.</figcaption>
        </figure>

        <section aria-labelledby="limits-title">
          <h2 id="limits-title" className="sr-only">Limits</h2>
          <ul className="limits-home">
            <li>
              <h3>No score</h3>
              <p>DevLens does not score, rank, or recommend anyone. It shows evidence next to its source event. The reviewer decides.</p>
            </li>
            <li>
              <h3>Not captured</h3>
              <p>A take does not capture {motif.notCaptured.slice(0, -1).join(', ')}, or {motif.notCaptured[motif.notCaptured.length - 1]}.</p>
            </li>
            <li>
              <h3>Consent first</h3>
              <p>Nothing records until the developer clicks. Audio and camera stay off. The whole desktop needs a second opt-in.</p>
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
