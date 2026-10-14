import AppKit
import IOKit.pwr_mgt

/// Counts time in the frontmost app. Time stops when the screen is locked or
/// asleep, and after a minute with no mouse or keyboard input, unless the
/// frontmost app is playing media. Media players (VLC, Spotify, QuickTime…)
/// also count while they play in the background.
///
/// "Playing" comes from power assertions, which need no permission:
///  • video: the app holds a keep-the-display-awake assertion;
///  • sound: coreaudiod holds a no-idle-sleep assertion "created for" the
///    app's PID while it plays audio.
/// Audio interface software and DAWs keep audio running all day, so sound
/// only counts for known media players and browsers.
final class Tracker {
    enum State: Equatable {
        case counting(String)
        case away
        case screenLocked
        case nothing
    }

    static let awayAfter: TimeInterval = 60
    private static let ignored: Set<String> = ["com.apple.loginwindow", "com.apple.ScreenSaver.Engine"]

    /// Counted whenever they're playing, even in the background.
    static let mediaPlayers: Set<String> = [
        "org.videolan.vlc", "com.spotify.client", "com.apple.QuickTimePlayerX", "com.apple.Music",
        "com.apple.podcasts", "com.apple.TV", "com.colliderli.iina", "com.plexapp.plexamp", "tv.plex.desktop",
        "com.tidal.desktop", "com.deezer.deezer-desktop", "com.audible.iphone", "com.apple.iBooksX",
        "com.netflix.Netflix", "com.amazon.aiv.AIVApp", "com.disney.disneyplus", "io.mpv", "com.firecore.infuse",
        "com.pocketcasts.mac", "fm.overcast.overcast", "com.soundcloud.desktop", "com.apple.VoiceMemos",
    ]
    /// Their sound keeps them counting while you're away, but only in front
    /// (background browser tabs are the extension's business).
    static let browsers: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary", "org.chromium.Chromium",
        "com.brave.Browser", "com.brave.Browser.beta", "com.microsoft.edgemac", "com.vivaldi.Vivaldi",
        "com.apple.Safari", "org.mozilla.firefox", "company.thebrowser.Browser",
    ]

    private(set) var day: String
    private(set) var today: [String: Double] = [:]
    private(set) var state: State = .nothing
    /// Media players counting in the background right now.
    private(set) var playingInBackground: [String] = []
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

        let media = Self.mediaPlaying()
        let newState = currentState(media)
        var counted = Set<String>()
        if case .counting(let name) = newState {
            today[name, default: 0] += dt
            counted.insert(name)
            dirty = true
        }
        // Media players playing behind other apps (Spotify while you work) and
        // while the screen is unlocked; away or not, you're listening.
        var background: [String] = []
        if !Self.screenLocked() {
            for app in NSWorkspace.shared.runningApplications
            where Self.mediaPlayers.contains(app.bundleIdentifier ?? "") && media.isPlaying(app) {
                guard let name = app.localizedName, !counted.contains(name) else { continue }
                today[name, default: 0] += dt
                counted.insert(name)
                background.append(name)
                dirty = true
            }
        }
        if newState != state || background != playingInBackground {
            state = newState
            playingInBackground = background
            onChange()
        }
        if dirty && now.timeIntervalSince(lastSave) >= 10 { save() }
        writeStatus(now)
    }

    /// status.json: what's being counted right now plus today's totals, every
    /// tick, for live readers like the Stream Deck plugin. A reader treats it
    /// as "TimeLock isn't running" once it's more than 30 seconds old.
    private func writeStatus(_ now: Date) {
        let stateName: String
        var front: String? = nil
        switch state {
        case .counting(let name): stateName = "counting"; front = name
        case .away: stateName = "away"
        case .screenLocked: stateName = "screenLocked"
        case .nothing: stateName = "idle"
        }
        var status: [String: Any] = [
            "at": (now.timeIntervalSince1970 * 1000).rounded(),
            "day": day,
            "state": stateName,
            "background": playingInBackground,
            "today": today.mapValues { ($0 * 10).rounded() / 10 },
            "version": AppVersion.version,
        ]
        if let front { status["app"] = front }
        do {
            let data = try JSONSerialization.data(withJSONObject: status, options: [.sortedKeys])
            try Store.writeAtomically(data, to: Store.statusFile)
        } catch {
            ErrorReporter.shared.report(AppError(.usageSaveFailed, "status.json — \(error.localizedDescription)"), surface: .logOnly)
        }
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

    private func currentState(_ media: Media) -> State {
        if Self.screenLocked() { return .screenLocked }
        guard let app = NSWorkspace.shared.frontmostApplication, let name = app.localizedName,
              app.bundleIdentifier != Bundle.main.bundleIdentifier,
              !Self.ignored.contains(app.bundleIdentifier ?? "") else { return .nothing }
        if Self.idleSeconds() >= Self.awayAfter && !media.keepsFrontAppCounting(app) { return .away }
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

    /// Which processes are playing video or sound right now.
    struct Media {
        var video: Set<pid_t> = []
        var sound: Set<pid_t> = []

        /// The app's own process or one of its helpers (browsers play media
        /// in helper processes that live inside their bundle).
        private func includes(_ pids: Set<pid_t>, _ app: NSRunningApplication) -> Bool {
            if pids.contains(app.processIdentifier) { return true }
            guard let bundle = app.bundleURL?.path else { return false }
            return pids.contains { Tracker.executablePath($0)?.hasPrefix(bundle + "/") == true }
        }

        func isPlaying(_ app: NSRunningApplication) -> Bool {
            includes(video, app) || includes(sound, app)
        }

        /// Video from any app counts; sound only from media players and browsers.
        func keepsFrontAppCounting(_ app: NSRunningApplication) -> Bool {
            if includes(video, app) { return true }
            let id = app.bundleIdentifier ?? ""
            return (Tracker.mediaPlayers.contains(id) || Tracker.browsers.contains(id)) && includes(sound, app)
        }
    }

    static func mediaPlaying() -> Media {
        var m = Media()
        var raw: Unmanaged<CFDictionary>?
        guard IOPMCopyAssertionsByProcess(&raw) == kIOReturnSuccess,
              let byPid = raw?.takeRetainedValue() as? [NSNumber: [[String: Any]]] else { return m }
        for (pid, assertions) in byPid {
            for a in assertions {
                let type = a["AssertType"] as? String ?? ""
                if type == "PreventUserIdleDisplaySleep" || type == "NoDisplaySleepAssertion" {
                    m.video.insert(pid.int32Value)
                }
                // coreaudiod's "created for PID" assertions while audio plays.
                if let forPid = (a["AssertionOnBehalfOfPID"] as? NSNumber)?.int32Value,
                   (a["AssertName"] as? String ?? "").hasPrefix("com.apple.audio.") {
                    m.sound.insert(forPid)
                }
            }
        }
        return m
    }

    static func executablePath(_ pid: pid_t) -> String? {
        var buf = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { return nil }
        return String(cString: buf)
    }
}
