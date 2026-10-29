// DevLens widget: a native macOS floating panel that hosts the DevLens agent page.
//
// Build:  npm run widget:build   (swiftc, no packages)
// Run:    npm run widget         (or .build/devlens-widget [--automation])
//
// - Accessory app: no Dock icon, no app menu.
// - Borderless, non-activating, floating panel on all Spaces, anchored bottom-right.
// - The page posts {type:'mode', mode, width, height} to window.webkit.messageHandlers.devlens
//   (DEC-19). The panel resizes and keeps its bottom-right corner fixed.
// - The panel never activates the app and never takes focus on its own (NOT-11).
// - --automation (DEC-20, demo only): each stdin line runs as page JavaScript.

import AppKit
import WebKit

// MARK: - Constants

let defaultURL = "http://localhost:3100/agent"
let pillSize = NSSize(width: 220, height: 44)
let edgeInset: CGFloat = 16
let retryInterval: TimeInterval = 5
let minSize = NSSize(width: 40, height: 24)
let maxSize = NSSize(width: 800, height: 900)

func logErr(_ line: String) {
    FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
}

func logOut(_ line: String) {
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

// MARK: - Panel

final class WidgetPanel: NSPanel {
    init(size: NSSize) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        // A WKWebView click does not ask its panel to become key, so typing in a textarea needs this off.
        // The panel stays non-activating: the app is never activated (NOT-11).
        becomesKeyOnlyIfNeeded = false
        isMovable = false
        isReleasedWhenClosed = false
    }

    // A click can make the panel key so a textarea takes typing.
    // The panel still does not activate the app (non-activating style).
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - Controller

final class WidgetController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let panel: WidgetPanel
    let webView: WKWebView
    let pageURL: URL
    var showingFallback = false
    var retryTimer: Timer?

    init(pageURL: URL) {
        self.pageURL = pageURL
        panel = WidgetPanel(size: pillSize)

        let config = WKWebViewConfiguration()
        let content = WKUserContentController()
        config.userContentController = content
        webView = WKWebView(frame: NSRect(origin: .zero, size: pillSize), configuration: config)

        super.init()

        content.add(self, name: "devlens")
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.autoresizingMask = [.width, .height]
        panel.contentView = webView
    }

    func start() {
        // Show a pill-size panel before the first mode message.
        apply(size: pillSize)
        panel.orderFrontRegardless()
        loadPage()
    }

    func loadPage() {
        showingFallback = false
        webView.load(URLRequest(url: pageURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10))
    }

    // MARK: Geometry

    func clamp(_ size: NSSize, to visible: NSRect) -> NSSize {
        let w = min(max(size.width, minSize.width), min(maxSize.width, visible.width - 2 * edgeInset))
        let h = min(max(size.height, minSize.height), min(maxSize.height, visible.height - 2 * edgeInset))
        return NSSize(width: w.rounded(), height: h.rounded())
    }

    @discardableResult
    func apply(size: NSSize) -> NSSize {
        guard let screen = NSScreen.screens.first ?? NSScreen.main else { return size }
        let visible = screen.visibleFrame
        let s = clamp(size, to: visible)
        // Bottom-right corner sits edgeInset from the bottom-right of visibleFrame.
        let origin = NSPoint(x: visible.maxX - edgeInset - s.width, y: visible.minY + edgeInset)
        panel.setFrame(NSRect(origin: origin, size: s), display: true)
        return s
    }

    // MARK: Page messages (DEC-19)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "devlens",
              let body = message.body as? [String: Any],
              body["type"] as? String == "mode",
              let mode = body["mode"] as? String else {
            logErr("ignored message \(message.body)")
            return
        }
        let width = (body["width"] as? NSNumber)?.doubleValue ?? Double(pillSize.width)
        let height = (body["height"] as? NSNumber)?.doubleValue ?? Double(pillSize.height)
        guard width.isFinite, height.isFinite else {
            logErr("ignored mode \(mode): bad size")
            return
        }
        if mode == "hidden" {
            panel.orderOut(nil)
            logErr("mode hidden")
            return
        }
        let s = apply(size: NSSize(width: width, height: height))
        // Never NSApp.activate: the frontmost app must stay frontmost (NOT-11).
        panel.orderFrontRegardless()
        logErr("mode \(mode) \(Int(s.width))x\(Int(s.height))")
    }

    // MARK: Navigation and offline fallback

    // Stay on the DevLens origin: other links open in the default browser, never inside the panel,
    // so no other site gets the `devlens` handler or the automation channel.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let sameOrigin = url.scheme == pageURL.scheme && url.host == pageURL.host && url.port == pageURL.port
        if sameOrigin || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        if mainFrame && (url.scheme == "http" || url.scheme == "https") { NSWorkspace.shared.open(url) }
        logErr("blocked navigation to \(url.absoluteString)")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if !showingFallback, let http = navigationResponse.response as? HTTPURLResponse,
           navigationResponse.isForMainFrame, http.statusCode >= 400 {
            decisionHandler(.cancel)
            showFallback(reason: "HTTP \(http.statusCode)")
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleFailure(error)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if !showingFallback {
            retryTimer?.invalidate()
            retryTimer = nil
            logErr("loaded \(pageURL.absoluteString)")
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        logErr("web content process ended; reloading in 2s")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.loadPage() }
    }

    func handleFailure(_ error: Error) {
        let ns = error as NSError
        // A cancel from our own policy decision or a new load is not a server failure.
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return } // frame load interrupted
        if showingFallback { return }
        showFallback(reason: ns.localizedDescription)
    }

    func showFallback(reason: String) {
        logErr("offline: \(reason); retry in \(Int(retryInterval))s")
        showingFallback = true
        webView.loadHTMLString(fallbackHTML, baseURL: nil)
        apply(size: pillSize)
        panel.orderFrontRegardless()
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: retryInterval, repeats: false) { [weak self] _ in
            self?.loadPage()
        }
    }

    // MARK: Automation (DEC-20)

    func startAutomation() {
        let thread = Thread { [weak self] in
            while let line = readLine(strippingNewline: true) {
                if line.trimmingCharacters(in: .whitespaces).isEmpty { continue }
                DispatchQueue.main.async { self?.evaluate(line) }
            }
        }
        thread.name = "devlens-automation-stdin"
        thread.start()
        logErr("automation on: reading stdin")
    }

    func evaluate(_ script: String) {
        webView.evaluateJavaScript(script) { result, error in
            if let error = error {
                let ns = error as NSError
                let detail = (ns.userInfo["WKJavaScriptExceptionMessage"] as? String) ?? ns.localizedDescription
                logOut("js-err " + oneLine(detail))
            } else {
                logOut("js-ok " + oneLine(describe(result)))
            }
        }
    }
}

func describe(_ value: Any?) -> String {
    guard let value = value else { return "undefined" }
    if value is NSNull { return "null" }
    if let s = value as? String { return s }
    if JSONSerialization.isValidJSONObject(value),
       let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        return s
    }
    return "\(value)"
}

func oneLine(_ s: String) -> String {
    s.replacingOccurrences(of: "\r", with: "\\r").replacingOccurrences(of: "\n", with: "\\n")
}

let fallbackHTML = """
<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center;
         font: 500 13px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; }
  .pill { box-sizing: border-box; width: 100%; height: 100%; display: flex; align-items: center;
          gap: 8px; padding: 0 14px; border-radius: 0; background: #111214;
          border: 1px solid #2a2c30; color: #e6e6e6; -webkit-user-select: none; cursor: default; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #6b6f76; flex: none; }
</style></head>
<body><div class="pill"><span class="dot"></span><span>DevLens · offline</span></div></body></html>
"""

// MARK: - Main

let arguments = CommandLine.arguments.dropFirst()
let automation = arguments.contains("--automation")
let urlString = ProcessInfo.processInfo.environment["DEVLENS_URL"].flatMap { $0.isEmpty ? nil : $0 } ?? defaultURL
guard let pageURL = URL(string: urlString), pageURL.scheme != nil else {
    logErr("DEVLENS_URL is not a valid URL: \(urlString)")
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// Launching makes this process frontmost once. Hand focus straight back to the app the developer was in (NOT-11).
let previousFront = NSWorkspace.shared.frontmostApplication
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
    if let previous = previousFront, previous.processIdentifier != getpid() { previous.activate() }
}

// Quit cleanly on SIGTERM and SIGINT.
var signalSources: [DispatchSourceSignal] = []
for sig in [SIGTERM, SIGINT] {
    signal(sig, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    source.setEventHandler {
        logErr("signal \(sig); quitting")
        exit(0)
    }
    source.resume()
    signalSources.append(source)
}

let controller = WidgetController(pageURL: pageURL)
logErr("devlens-widget loading \(pageURL.absoluteString)")
controller.start()
if automation { controller.startAutomation() }

app.run()
