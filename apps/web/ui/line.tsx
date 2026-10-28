'use client';

import type { KeyboardEvent } from 'react';
import { clock, type LineLayout, type PlacedStation } from '../replay/compile';

function stationLabel(station: PlacedStation): string {
  const where = station.session == null ? 'outside the recording' : `session ${station.session}, ${clock(station.offset_ms)}`;
  const stamp = station.superseded ? ', superseded, kept on the line' : '';
  return `${station.title}: ${station.detail}${stamp}. ${where}.`;
}

// Station marks pair a shape with the colour, so state never rests on colour alone.
function Mark({ station }: { station: PlacedStation }) {
  const { x, y } = station;
  switch (station.kind) {
    case 'prompt':
      return <rect className="mk mk-prompt" x={x - 8} y={y - 8} width={16} height={16} />;
    case 'edit':
      return <rect className="mk mk-edit" x={x - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${x} ${y})`} />;
    case 'test_failed':
      return (
        <g className="mk mk-failed">
          <circle cx={x} cy={y} r={11} />
          <path d={`M${x - 4.5} ${y - 4.5}L${x + 4.5} ${y + 4.5}M${x + 4.5} ${y - 4.5}L${x - 4.5} ${y + 4.5}`} />
        </g>
      );
    case 'test_passed':
      return (
        <g className="mk mk-passed">
          <circle className="mk-terminus" cx={x} cy={y} r={20} />
          <circle className="mk-disc" cx={x} cy={y} r={13} />
          <path d={`M${x - 6} ${y}L${x - 1.5} ${y + 4.5}L${x + 6.5} ${y - 4.5}`} />
        </g>
      );
    case 'rerun':
      return <rect className="mk mk-rerun" x={x - 9} y={y - 9} width={18} height={18} rx={2} />;
    default:
      return <circle className="mk mk-unknown" cx={x} cy={y} r={8} />;
  }
}

export function TransitLine({
  layout,
  label,
  selected = null,
  highlight = null,
  onSelect,
  compact = false,
}: {
  layout: LineLayout;
  label: string;
  selected?: string | null;
  highlight?: ReadonlySet<string> | null;
  onSelect?: (id: string) => void;
  compact?: boolean;
}) {
  const interactive = onSelect != null;
  const vertical = layout.orientation === 'vertical';
  const keyed = (id: string) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(id);
    }
  };
  return (
    <svg
      className={compact ? 'line line--compact' : vertical ? 'line line--vertical' : 'line'}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
      height={layout.height}
      role={interactive ? 'group' : 'img'}
      aria-label={label}
      data-filtered={highlight ? 'true' : undefined}
    >
      {!compact
        ? layout.sessions.map((session) => (
            <text key={session.label} className="ln-cap" x={session.x} y={vertical ? session.y : session.y - 82}>
              {session.label}
            </text>
          ))
        : null}
      <path className="ln ln-session" d={layout.session_path} />
      <path className="ln ln-route" d={layout.route_path} />
      <path className="ln ln-rerun" d={layout.rerun_path} />
      {layout.transfers.map((transfer) => (
        <g key={`${transfer.x}-${transfer.y}`} className="transfer">
          <circle cx={transfer.x} cy={transfer.y} r={compact ? 5 : 8} />
          {!compact && !vertical ? <text className="ln-small" x={transfer.x - 14} y={transfer.y + 4} textAnchor="end">transfer</text> : null}
        </g>
      ))}
      {layout.stations.map((station) => {
        const isSelected = station.id === selected;
        const dim = highlight != null && !highlight.has(station.id);
        const below = station.kind === 'test_passed' ? 38 : station.superseded ? 50 : 30;
        const above = station.kind === 'test_passed' ? 50 : 44;
        return (
          <g
            key={station.id}
            className="st"
            data-kind={station.kind}
            data-dim={dim ? 'true' : undefined}
            data-selected={isSelected ? 'true' : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-pressed={interactive ? isSelected : undefined}
            aria-label={interactive ? stationLabel(station) : undefined}
            onClick={interactive ? () => onSelect?.(station.id) : undefined}
            onKeyDown={interactive ? keyed(station.id) : undefined}
          >
            {interactive && vertical ? <rect className="st-hit" x={0} y={station.y - 30} width={layout.width} height={60} /> : null}
            {interactive && !vertical ? <circle className="st-hit" cx={station.x} cy={station.y} r={34} /> : null}
            <circle className="st-ring" cx={station.x} cy={station.y} r={station.kind === 'test_passed' ? 27 : 20} />
            <Mark station={station} />
            {vertical ? (
              <>
                {station.kind === 'rerun' ? null : (
                  <text className="ln-time" x={layout.time_x} y={station.y + 4} textAnchor="end">
                    {clock(station.offset_ms)}
                  </text>
                )}
                <text className="ln-title" x={layout.label_x} y={station.y - 3}>
                  {station.title}
                </text>
                {station.lines.map((line, index) => (
                  <text key={line} className="ln-detail" x={layout.label_x} y={station.y + 12 + index * 14}>
                    {line}
                  </text>
                ))}
                {station.superseded ? (
                  <g className="stamp">
                    <rect x={layout.label_x} y={station.y + 4 + station.lines.length * 14} width={88} height={18} />
                    <text x={layout.label_x + 44} y={station.y + 17 + station.lines.length * 14} textAnchor="middle">SUPERSEDED</text>
                  </g>
                ) : null}
              </>
            ) : null}
            {!compact && !vertical ? (
              <>
                <text className="ln-title" x={station.x} y={station.y - above - (station.lines.length - 1) * 14} textAnchor="middle">
                  {station.title}
                </text>
                {station.lines.map((line, index) => (
                  <text key={line} className="ln-detail" x={station.x} y={station.y - above + 14 + (index - (station.lines.length - 1)) * 14} textAnchor="middle">
                    {line}
                  </text>
                ))}
                {station.superseded ? (
                  <g className="stamp">
                    <rect x={station.x - 44} y={station.y + 14} width={88} height={19} />
                    <text x={station.x} y={station.y + 27.5} textAnchor="middle">SUPERSEDED</text>
                  </g>
                ) : null}
                <text className="ln-time" x={station.x} y={station.y + below + 10} textAnchor="middle">
                  {station.kind === 'rerun' ? 'no footage' : clock(station.offset_ms)}
                </text>
              </>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
