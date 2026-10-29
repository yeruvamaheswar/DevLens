// Pure geometry for the journey line. Rows run left to right, then right to left, joined by U-turns,
// like a metro line drawn on one sheet. The separate re-run leaves the line as a branch.
import type { JourneyStation } from './build';

export type Placed = JourneyStation & { x: number; y: number; lines: string[] };
export type JourneyLayout = {
  width: number;
  height: number;
  stations: Placed[];
  line: string; // every main station in time order
  chain: string; // the failure-to-fix part of the line
  branches: string; // separate re-run branches
  rows: number;
};

export const LAYOUT = { width: 1200, padX: 112, step: 139, rowH: 178, top: 74, turn: 10, branchSpace: 120 } as const;

function wrap(value: string, width: number, max: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    const kept = lines.slice(0, max);
    kept[max - 1] = `${kept[max - 1].slice(0, width - 1)}…`;
    return kept;
  }
  return lines.map((item) => (item.length > width + 4 ? `${item.slice(0, width)}…` : item));
}

export function perRow(width: number = LAYOUT.width): number {
  return Math.floor((width - 2 * LAYOUT.padX) / LAYOUT.step) + 1;
}

// One segment between two consecutive main stations. A row change is a half-circle turn outside the last column.
export function segment(a: Pick<Placed, 'x' | 'y'>, b: Pick<Placed, 'x' | 'y'>, width: number = LAYOUT.width): string {
  if (a.y === b.y) return `M${a.x} ${a.y}H${b.x}`;
  const radius = (b.y - a.y) / 2;
  const right = a.x > width / 2;
  const edge = right ? width - LAYOUT.padX + LAYOUT.turn : LAYOUT.padX - LAYOUT.turn;
  return `M${a.x} ${a.y}H${edge}A${radius} ${radius} 0 0 ${right ? 1 : 0} ${edge} ${b.y}H${b.x}`;
}

export function journeyLayout(stations: readonly JourneyStation[], options: { width?: number; rerunOf?: (id: string) => string | null } = {}): JourneyLayout {
  const width = options.width ?? LAYOUT.width;
  const n = perRow(width);
  const main = stations.filter((item) => !item.branch);
  const branches = stations.filter((item) => item.branch);
  const targetOf = (item: JourneyStation) => {
    const targetId = options.rerunOf?.(item.id) ?? null;
    const index = main.findIndex((station) => station.event_ids.includes(targetId ?? ''));
    if (index >= 0) return index;
    for (let i = main.length - 1; i >= 0; i--) if (main[i].kind === 'test_passed') return i;
    return main.length - 1;
  };
  // A row that sends out a re-run branch gets extra room below it, so the branch never crosses labels.
  const branchRows = new Set(branches.map((item) => Math.floor(Math.max(targetOf(item), 0) / n)));
  const rowY = (row: number) => {
    let y = LAYOUT.top + row * LAYOUT.rowH;
    for (const branchRow of branchRows) if (branchRow < row) y += LAYOUT.branchSpace;
    return y;
  };
  const placed: Placed[] = main.map((item, index) => {
    const row = Math.floor(index / n);
    const col = index % n;
    const x = row % 2 === 0 ? LAYOUT.padX + col * LAYOUT.step : width - LAYOUT.padX - col * LAYOUT.step;
    return { ...item, x, y: rowY(row), lines: wrap(item.detail, 21, 2) };
  });

  const parts: string[] = [];
  const chainParts: string[] = [];
  for (let i = 1; i < placed.length; i++) {
    const d = segment(placed[i - 1], placed[i], width);
    parts.push(d);
    if (placed[i - 1].chain && placed[i].chain) chainParts.push(d);
  }

  let branchPath = '';
  branches.forEach((item, offset) => {
    const index = targetOf(item);
    const from = placed[index];
    if (!from) return;
    // Leave in the direction the row runs, then drop below the row's labels.
    const row = Math.floor(index / n);
    const endY = from.y + LAYOUT.branchSpace - 10;
    const bend = endY - from.y;
    const run = 46 + bend + 70 + offset * LAYOUT.step;
    let dir = row % 2 === 0 ? 1 : -1;
    if (from.x + dir * run > width - 80 || from.x + dir * run < 80) dir = -dir;
    const endX = from.x + dir * run;
    // Out along the line first, clear of the station's own labels, then 45 degrees down.
    branchPath += `M${from.x} ${from.y}H${from.x + dir * 46}L${from.x + dir * (46 + bend)} ${endY}H${endX}`;
    placed.push({ ...item, x: endX, y: endY, lines: wrap(item.detail, 21, 2) });
  });

  const rows = Math.max(1, Math.ceil(main.length / n));
  const lowest = Math.max(...placed.map((item) => item.y), LAYOUT.top);
  return { width, height: lowest + 96, stations: placed, line: parts.join(''), chain: chainParts.join(''), branches: branchPath, rows };
}
