export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: 24, fontFamily: 'system-ui', lineHeight: 1.6 }}>
      <h1>DevLens</h1>
      <p>An evidence agent for a consented coding task. It shows what was recorded. It does not score anyone.</p>
      <ul>
        <li><a href="/replay">Replay the golden take</a></li>
        <li><a href="/record">Record a window (upload is off unless enabled)</a></li>
      </ul>
    </main>
  );
}
