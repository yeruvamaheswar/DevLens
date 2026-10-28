import type { ReactNode } from 'react';

type Place = 'home' | 'replay' | 'record';

function Wordmark() {
  return (
    <a className="wm" href="/" aria-label="DevLens home">
      <svg width="34" height="18" viewBox="0 0 34 18" aria-hidden="true">
        <path className="wm-line" d="M4 9H20L26 3" />
        <circle className="wm-start" cx="4" cy="9" r="3.5" />
        <circle className="wm-end" cx="27" cy="3" r="3" />
      </svg>
      DevLens
    </a>
  );
}

export function TopBar({ place, take }: { place: Place; take?: ReactNode }) {
  const link = (target: Place, href: string, text: string) => (
    <a href={href} aria-current={place === target ? 'page' : undefined}>
      {text}
    </a>
  );
  return (
    <header className="topbar">
      <a className="skip" href="#main">Skip to content</a>
      <Wordmark />
      <nav aria-label="Main">
        {link('replay', '/replay', 'Replay')}
        {link('record', '/record', 'Record')}
        <span className="nav-later" title="The scenario catalog is not built yet">
          Scenarios <small>later</small>
        </span>
      </nav>
      {take ? <div className="take">{take}</div> : null}
    </header>
  );
}
