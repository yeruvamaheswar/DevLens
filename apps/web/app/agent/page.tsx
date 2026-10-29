import type { Metadata } from 'next';
import { Widget } from '../../agent/widget';

export const metadata: Metadata = { title: 'DevLens Agent' };

// The native panel loads this page. `?demo` shows fixed states for a visual check and fetches nothing.
export default async function AgentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const demo = (await searchParams).demo !== undefined;
  return <Widget demo={demo} />;
}
