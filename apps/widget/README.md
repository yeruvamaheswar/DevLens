# DevLens widget

The DevLens widget is a small native macOS panel. It floats at the bottom-right of the main screen, above other apps. It shows the DevLens Agent page (`/agent`) from the running DevLens server.

- It runs as a background agent: no Dock icon, no app menu, no normal window.
- It never takes focus on its own. The frontmost app stays frontmost when a pop-up appears. The panel takes keyboard input only after you click it.
- It shows on all Spaces and next to full-screen apps.

It is one Swift file, `DevLensWidget.swift`, built with the system `swiftc`. It uses only AppKit and WebKit. There are no packages to install.

## Requirements

- macOS with the Xcode command line tools (`swiftc`).
- The DevLens server must be running on port 3100. Start it first, for example with `npx next dev apps/web -p 3100`. The widget loads `http://localhost:3100/agent` by default. If the server is not running, the widget shows "DevLens · offline".

## Run

```sh
npm run widget
```

This command builds `.build/devlens-widget` and starts it. To build only, run `npm run widget:build`.

Stop the widget with Ctrl+C in its terminal, or send it SIGTERM.

## Configuration

| Setting | Default | Meaning |
|---|---|---|
| `DEVLENS_URL` (env) | `http://localhost:3100/agent` | The page that the panel loads |

Example:

```sh
DEVLENS_URL=http://localhost:3200/agent npm run widget
```

## Page-to-panel protocol

The page posts this message to `window.webkit.messageHandlers.devlens`:

```js
{ type: 'mode', mode: 'hidden' | 'pill' | 'popup' | 'queue', width, height }
```

- `width` and `height` are CSS pixels. The panel uses them as points.
- The panel resizes and keeps its bottom-right corner 16 pt from the bottom-right of the screen's visible area.
- `hidden` hides the panel. Any other mode shows it without activating the app.
- The size is clamped to 40×24 – 800×900 pt and to the screen.
- Each mode change prints `mode <name> <w>x<h>` to stderr.

## Offline behavior

If the page cannot load (server down or an HTTP error), the panel shows a native pill that reads "DevLens · offline". It retries the real URL every 5 seconds. Before the first mode message, the panel shows at pill size (220×44 pt).

## Automation (demo only)

```sh
npm run widget -- --automation
```

With `--automation`, the widget reads lines from stdin. It runs each line as JavaScript in the page. It prints one line per result to stdout:

- `js-ok <result>` on success. Objects print as JSON.
- `js-err <message>` on a JavaScript error.

Use this flag only for scripted demos. Without the flag, the widget ignores stdin.
