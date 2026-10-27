export type CommitDiff = { name: string; patch: string; files: string[] };

export function parseCommitDiffs(text: string): CommitDiff[] {
  return text.split(/^commit /m).filter(Boolean).map((part) => {
    const breakAt = part.indexOf('\n');
    const title = (breakAt === -1 ? part : part.slice(0, breakAt)).trim();
    const name = title.split(/\s+/).slice(1).join(' ') || title;
    const patch = breakAt === -1 ? '' : part.slice(breakAt + 1).trim();
    const files = [...patch.matchAll(/^diff --git a\/(.+?) b\//gm)].map((match) => match[1]);
    return { name, patch, files };
  });
}
