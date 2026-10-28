// Started by the Stop hook, detached. argv: projectDir session_id stop_event_id. Always exits 0.
import { runAtStop } from './run';

const [projectDir, session_id, stop_event_id] = process.argv.slice(2);
async function main(): Promise<void> {
  if (!projectDir || !session_id || !stop_event_id) return;
  try {
    await runAtStop({ projectDir, session_id, stop_event_id });
  } catch {
    // Failures are in the ledger. The hook never waits on this process.
  }
}
void main().finally(() => process.exit(0));
