import AppKit

/// The link to the browser extension. Chrome/Brave/Edge start this same
/// executable in "connector" mode (native messaging, host com.jonpike.timelock)
/// with the extension's origin as an argument, talk to it over stdin/stdout
/// (4-byte little-endian length + JSON per message), and close it afterwards.
/// It saves what the extension sent and answers with today's app time from
/// the shared data folder; the menu bar app does the tracking.
enum Connector {
    static func isConnectorLaunch(_ args: [String]) -> Bool {
        args.dropFirst().contains { $0.hasPrefix("chrome-extension://") }
    }

    static func run() -> Never {
        let input = FileHandle.standardInput
        while true {
            let header = input.readData(ofLength: 4)
            guard header.count == 4 else { exit(0) } // the browser closed the pipe
            let length = header.withUnsafeBytes { UInt32(littleEndian: $0.loadUnaligned(as: UInt32.self)) }
            guard length > 0, length < 8 * 1024 * 1024 else { exit(0) }
            let body = input.readData(ofLength: Int(length))
            send(handle(body))
        }
    }

    static func handle(_ body: Data) -> [String: Any] {
        do {
            guard let msg = try JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let type = msg["type"] as? String else {
                throw AppError(.connectorFailed, "message isn't a JSON object with a type")
            }
            switch type {
            case "ping":
                return ["ok": true, "version": AppVersion.version, "running": menuBarAppRunning()]
            case "listen":
                // The extension keeps this connection open so the menu bar
                // app can ask it to open its popup (see PopupRequest).
                PopupRequest.rememberBrowser()
                PopupRequest.startWatching { send(["type": "openPopup"]) }
                return ["ok": true, "type": "listening", "version": AppVersion.version]
            case "popupOpened":
                PopupRequest.acknowledge(msg["how"] as? String ?? "popup")
                return ["ok": true, "type": "ack"]
            case "sync":
                let snap: BrowserSnapshot
                do { snap = try JSONDecoder().decode(BrowserSnapshot.self, from: body) } catch {
                    throw AppError(.connectorFailed, "sync message: \(error.localizedDescription)")
                }
                try Store.saveBrowser(snap)
                let apps = (try? Store.loadApps(snap.day, repair: false)) ?? [:]
                return [
                    "ok": true,
                    "version": AppVersion.version,
                    "running": menuBarAppRunning(),
                    "apps": apps.mapValues { ($0 * 10).rounded() / 10 },
                    "known": Store.knownApps(),
                ]
            default:
                throw AppError(.connectorFailed, "unknown message type \"\(type)\"")
            }
        } catch {
            let e = AppError(wrapping: error)
            ErrorReporter.shared.log(e)
            return ["ok": false, "error": "\(e.code.rawValue): \(e.code.summary) \(e.detail ?? "")"]
        }
    }

    private static let writeLock = NSLock()

    /// Replies and pushed requests can come from two threads, so writes are serialised.
    static func send(_ reply: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: reply) else { return }
        var length = UInt32(data.count).littleEndian
        writeLock.lock()
        defer { writeLock.unlock() }
        let out = FileHandle.standardOutput
        out.write(Data(bytes: &length, count: 4))
        out.write(data)
    }

    /// The connector is a separate, short-lived process; app time only grows
    /// while the menu bar app itself is running.
    private static func menuBarAppRunning() -> Bool {
        let me = ProcessInfo.processInfo.processIdentifier
        return NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier ?? "com.jonpike.timelock")
            .contains { $0.processIdentifier != me }
    }
}

/// Clicking the menu bar icon opens the extension's popup. Apps can't open an
/// extension popup themselves, so the request goes through the data folder:
///   1. the menu bar app writes open-popup.request and brings the browser forward;
///   2. the connector that the extension keeps open ("listen") claims it and
///      sends {"type":"openPopup"} to the extension;
///   3. the extension opens its popup (or a tab) and answers "popupOpened";
///      the connector writes open-popup.ack, which the menu bar app waits for.
/// A request older than 15 s is stale, so launching the browser later can't
/// pop the popup open out of nowhere.
enum PopupRequest {
    static let requestFile = Store.folder.appendingPathComponent("open-popup.request")
    static let ackFile = Store.folder.appendingPathComponent("open-popup.ack")
    /// Which browser the extension lives in (the connector's parent process).
    static let browserFile = Store.folder.appendingPathComponent("browser-app.txt")
    static let freshFor: TimeInterval = 15
    private static var timer: DispatchSourceTimer?

    static func rememberBrowser() {
        guard let id = NSRunningApplication(processIdentifier: getppid())?.bundleIdentifier else { return }
        try? Store.ensureFolders()
        try? Store.writeAtomically(Data(id.utf8), to: browserFile)
    }

    static var browserBundleID: String? {
        (try? String(contentsOf: browserFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Connector side: poll for a request every 0.25 s and claim it by renaming,
    /// so two browsers both listening can't both open a popup.
    static func startWatching(_ fire: @escaping () -> Void) {
        guard timer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
        t.schedule(deadline: .now(), repeating: .milliseconds(250))
        t.setEventHandler {
            let claimed = requestFile.appendingPathExtension("claimed-\(getpid())")
            guard rename(requestFile.path, claimed.path) == 0 else { return }
            let age = ((try? FileManager.default.attributesOfItem(atPath: claimed.path))?[.modificationDate] as? Date)
                .map { Date().timeIntervalSince($0) } ?? 0
            try? FileManager.default.removeItem(at: claimed)
            if age < freshFor { fire() }
        }
        t.resume()
        timer = t
    }

    static func acknowledge(_ how: String) {
        try? Store.writeAtomically(Data(how.utf8), to: ackFile)
    }
}

/// Tells each installed Chromium browser where the connector is. Done at every
/// launch, so moving the app just needs one relaunch.
enum BrowserLink {
    static let hostName = "com.jonpike.timelock"
    /// Fixed by the "key" in the extension's manifest.json.
    static let extensionID = "jhoilplbkfpfihboddmplmbblcenmapn"
    static let browsers: [(name: String, dir: String)] = [
        ("Chrome", "Google/Chrome"),
        ("Chrome Beta", "Google/Chrome Beta"),
        ("Chrome Canary", "Google/Chrome Canary"),
        ("Chromium", "Chromium"),
        ("Brave", "BraveSoftware/Brave-Browser"),
        ("Brave Beta", "BraveSoftware/Brave-Browser-Beta"),
        ("Edge", "Microsoft Edge"),
        ("Vivaldi", "Vivaldi"),
    ]

    /// Returns the browsers it registered with.
    @discardableResult
    static func register() throws -> [String] {
        guard let exe = Bundle.main.executablePath else { throw AppError(.browserLinkFailed, "no executable path") }
        let manifest: [String: Any] = [
            "name": hostName,
            "description": "TimeLock for Mac — shares app time with the TimeLock extension",
            "path": exe,
            "type": "stdio",
            "allowed_origins": ["chrome-extension://\(extensionID)/"],
        ]
        let data = try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        var done: [String] = []
        var failures: [String] = []
        for b in browsers {
            let base = support.appendingPathComponent(b.dir, isDirectory: true)
            guard FileManager.default.fileExists(atPath: base.path) else { continue }
            let dir = base.appendingPathComponent("NativeMessagingHosts", isDirectory: true)
            let file = dir.appendingPathComponent("\(hostName).json")
            do {
                if (try? Data(contentsOf: file)) != data {
                    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                    try Store.writeAtomically(data, to: file)
                }
                done.append(b.name)
            } catch {
                failures.append("\(file.path) — \(error.localizedDescription)")
            }
        }
        if !failures.isEmpty { throw AppError(.browserLinkFailed, failures.joined(separator: "; ")) }
        return done
    }
}
