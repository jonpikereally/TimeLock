import AppKit
import IOKit.pwr_mgt

/// Counts time in the frontmost app. Time stops when the screen is locked or
/// asleep, and after a minute with no mouse or keyboard input, unless the
/// frontmost app is playing video (it holds a "keep the display awake"
/// power assertion, which is how macOS video players stop the screen dimming).
final class Tracker {
    enum State: Equatable {
        case counting(String)
        case away
        case screenLocked
        case nothing
    }

    static let awayAfter: TimeInterval = 60
    private static let ignored: Set<String> = ["com.apple.loginwindow", "com.apple.ScreenSaver.Engine"]

    private(set) var day: String
    private(set) var today: [String: Double] = [:]
    private(set) var state: State = .nothing
    var onChange: () -> Void = {}

    private var last = Date()
    private var lastSave = Date()
    private var dirty = false
    private var timer: Timer?

    init() {
        day = Store.dayKey(Date(), resetHour: Store.resetHour)
        today = load(day)
    }

    func start() {
        let t = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t
        let nc = NSWorkspace.shared.notificationCenter
        nc.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in self?.tick() }
        nc.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { [weak self] _ in
            self?.tick()
            self?.save()
        }
        nc.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in self?.last = Date() }
    }

    func tick() {
        let now = Date()
        // Never count more than a few seconds per tick, so a sleep or a
        // stalled timer doesn't add a lump of time.
        let dt = min(max(now.timeIntervalSince(last), 0), 5)
        last = now

        let d = Store.dayKey(now, resetHour: Store.resetHour)
        if d != day {
            save()
            day = d
            today = load(d)
        }

        let newState = currentState()
        if case .counting(let name) = newState {
            today[name, default: 0] += dt
            dirty = true
        }
        if newState != state {
            state = newState
            onChange()
        }
        if dirty && now.timeIntervalSince(lastSave) >= 10 { save() }
    }

    func save() {
        guard dirty else { return }
        do {
            try Store.saveApps(day, today)
            dirty = false
            lastSave = Date()
        } catch {
            ErrorReporter.shared.report(AppError(wrapping: error), surface: .menu)
            lastSave = Date() // don't retry every tick
        }
    }

    private func load(_ day: String) -> [String: Double] {
        do { return try Store.loadApps(day, repair: true) } catch {
            ErrorReporter.shared.report(AppError(wrapping: error), surface: .menu)
            return [:]
        }
    }

    private func currentState() -> State {
        if Self.screenLocked() { return .screenLocked }
        guard let app = NSWorkspace.shared.frontmostApplication, let name = app.localizedName,
              app.bundleIdentifier != Bundle.main.bundleIdentifier,
              !Self.ignored.contains(app.bundleIdentifier ?? "") else { return .nothing }
        if Self.idleSeconds() >= Self.awayAfter && !Self.playingVideo(app) { return .away }
        return .counting(name)
    }

    // MARK: - System checks (none need a privacy permission)

    static func idleSeconds() -> TimeInterval {
        guard let any = CGEventType(rawValue: ~0) else { return 0 }
        return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: any)
    }

    static func screenLocked() -> Bool {
        guard let info = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        if (info["CGSSessionScreenIsLocked"] as? Bool) == true { return true }
        if let onConsole = info[kCGSessionOnConsoleKey as String] as? Bool, !onConsole { return true }
        return false
    }

    /// True when the app (or one of its helper processes, which live inside
    /// its bundle — browsers play video in helpers) is keeping the display awake.
    static func playingVideo(_ app: NSRunningApplication) -> Bool {
        guard let bundlePath = app.bundleURL?.path else { return false }
        var raw: Unmanaged<CFDictionary>?
        guard IOPMCopyAssertionsByProcess(&raw) == kIOReturnSuccess,
              let byPid = raw?.takeRetainedValue() as? [NSNumber: [[String: Any]]] else { return false }
        for (pid, assertions) in byPid {
            let keepsDisplayOn = assertions.contains {
                let type = $0["AssertType"] as? String
                return type == "PreventUserIdleDisplaySleep" || type == "NoDisplaySleepAssertion"
            }
            guard keepsDisplayOn else { continue }
            if pid.int32Value == app.processIdentifier { return true }
            if let path = executablePath(pid.int32Value), path.hasPrefix(bundlePath + "/") { return true }
        }
        return false
    }

    private static func executablePath(_ pid: pid_t) -> String? {
        var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { return nil }
        return String(cString: buf)
    }
}
