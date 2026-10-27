# Recorder

The record page is `/record`. A page load does not call `getDisplayMedia`. Window mode is the default. The developer clicks **Record one window** or **Record my desktop (second opt-in)**, reviews the file, and only then clicks **Upload**.

## Modes

**Record one window** asks for one window. The saved `mode` is `window`. If the browser reports `display_surface` `monitor`, that take is discarded and the page asks again.

**Record my desktop (second opt-in)** is a second click. Window start cannot open it. The saved `mode` is `desktop`. A monitor take is kept. A monitor take can show other windows and notifications. If the browser reports a window, a browser tab, or an unknown surface instead of a monitor, the take is kept and `display_surface` records what was captured. Audio and camera stay off. The developer can delete the take before upload.

Neither mode records the microphone, the camera, or keystroke timing. The review screen shows the take mode, `window` or `desktop`, and the captured surface.

## `DEVLENS_RECORD_ENABLED`

Set this server-side variable to the exact value `1` to allow recording grants and metadata writes. Any other value, including an unset variable, makes `POST /api/recordings` and `POST /api/recordings/<id>/meta` return 403.

```text
DEVLENS_RECORD_ENABLED=1
```

Do not prefix it with `NEXT_PUBLIC_`. Add that line to the repo-root `.env.example`. Keep the real value in the local `.env`, which stays untracked.

Next serves `apps/web` and does not load the repo-root `.env` by itself. The recording routes load the first `.env` found from the process directory upward, and they do not override variables that are already set. They never print those values.

The browser upload uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The service-role key stays on the server. The only accepted Supabase host is `hivfaqlabtbrhrviwrrm.supabase.co`.

The server accepts `mode` `desktop` only with the same consent checks as window mode. `display_surface` must be the value the browser reported: `window`, `monitor`, `browser`, or `unknown`. A monitor is stored only when `mode` is `desktop`. A window-mode take stays `mode` `window`. A monitor take labeled `window` is refused.
