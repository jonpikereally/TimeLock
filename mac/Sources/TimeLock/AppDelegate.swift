import AppKit
import ServiceManagement

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private let tracker = Tracker()
    private let menu = NSMenu()
    private var linkedBrowsers: [String] = []

    static let repoURL = "https://github.com/jonpikereally/TimeLock"
    /// How old the extension's last sync can be before we call it disconnected.
    private static let browserFresh: TimeInterval = 3 * 60

    func applicationDidFinishLaunching(_ notification: Notification) {
        do { try Store.ensureFolders() } catch {
            ErrorReporter.shared.report(AppError(wrapping: error), surface: .menu)
        }
        linkBrowsers()
        Store.pruneOldDays()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        refreshIcon()
        menu.delegate = self
        menu.autoenablesItems = false
        // A click shows this menu; its "Open TimeLock in the Browser" item opens
        // the extension's popup (Jon preferred the menu on click, 2026-10-15).
        statusItem.menu = menu

        tracker.onChange = { [weak self] in self?.refreshIcon() }
        tracker.start()
        ErrorReporter.shared.onChange = { [weak self] in self?.refreshIcon() }
        reportFailedUpdateIfAny()
        Updater.shared.onChange = { [weak self] in self?.refreshIcon() }
        Updater.shared.startAutomaticChecks()
        firstLaunch()
    }

    func applicationWillTerminate(_ notification: Notification) {
        tracker.tick()
        tracker.save()
    }

    private func linkBrowsers() {
        do { linkedBrowsers = try BrowserLink.register() } catch {
            ErrorReporter.shared.report(AppError(wrapping: error), surface: .menu)
        }
    }

    /// Turns on Open at Login once, since a tracker that isn't running
    /// doesn't track, and says what TimeLock does.
    private func firstLaunch() {
        let key = "didFirstLaunch"
        guard !UserDefaults.standard.bool(forKey: key) else { return }
        UserDefaults.standard.set(true, forKey: key)
        try? SMAppService.mainApp.register()
        let alert = NSAlert()
        alert.messageText = "TimeLock is tracking your app time"
        alert.informativeText = "Look for the hourglass in the menu bar. TimeLock counts time in the app you're using, "
            + "and pauses when you're away for a minute (unless a video is playing) or the screen is locked.\n\n"
            + "It also opens at login; turn that off in its menu.\n\n"
            + "With the TimeLock browser extension installed, your app time shows up in the extension, a daily limit can "
            + "include apps, and the menu here shows your website time too. Apps are never locked."
            + (linkedBrowsers.isEmpty ? "" : "\n\nConnected to: \(linkedBrowsers.joined(separator: ", ")).")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    // MARK: - "Open TimeLock in the Browser" → extension popup

    private func showMenu() {
        statusItem.button?.performClick(nil)
    }

    private var popupWait: Timer?

    @objc private func openExtensionPopup() {
        popupWait?.invalidate()
        let fm = FileManager.default
        try? fm.removeItem(at: PopupRequest.ackFile)
        do {
            try Store.ensureFolders()
            try Store.writeAtomically(Data("\(Date().timeIntervalSince1970)".utf8), to: PopupRequest.requestFile)
        } catch {
            return ErrorReporter.shared.report(AppError(.popupFailed, "open-popup.request — \(error.localizedDescription)"),
                                               surface: .alert, title: "Couldn't open TimeLock")
        }
        // Bring the browser forward (launching it if needed): popups open in its front window.
        let id = PopupRequest.browserBundleID ?? "com.brave.Browser"
        if let running = NSRunningApplication.runningApplications(withBundleIdentifier: id).first {
            running.activate()
        } else if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) {
            NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        }
        // Wait for the extension to confirm; a cold browser launch can take a while.
        let started = Date()
        popupWait = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] t in
            if fm.fileExists(atPath: PopupRequest.ackFile.path) {
                try? fm.removeItem(at: PopupRequest.ackFile)
                t.invalidate()
            } else if Date().timeIntervalSince(started) > PopupRequest.freshFor {
                t.invalidate()
                try? fm.removeItem(at: PopupRequest.requestFile)
                let e = AppError(.popupFailed, "No answer from the extension in \(id) within \(Int(PopupRequest.freshFor)) s")
                ErrorReporter.shared.log(e)
                if ErrorReporter.shared.present(e, title: "Couldn't open the TimeLock popup", actions: ["Show Menu"]) == 0 {
                    self?.showMenu()
                }
            }
        }
    }

    // MARK: - Menu (rebuilt each time it opens, so the numbers are live)

    func menuNeedsUpdate(_ menu: NSMenu) {
        tracker.tick()
        menu.removeAllItems()

        // Problem row first, so it's never missed.
        if let p = ErrorReporter.shared.pending {
            let row = item("⚠️ Problem \(p.code.rawValue) — click for details", #selector(showPendingProblem))
            row.toolTip = ErrorReporter.tooltip
            menu.addItem(row)
            menu.addItem(.separator())
        }

        let browser = Store.loadBrowser()
        // Apps today
        let apps = tracker.today.sorted { $0.value > $1.value }
        let total = apps.reduce(0) { $0 + $1.value }
        menu.addItem(header("Today on your Mac — \(Self.duration(total))"))
        menu.addItem(info(statusText()))
        for (name, secs) in apps.prefix(10) {
            let live: Bool
            if case .counting(let n) = tracker.state { live = n == name } else { live = false }
            let playing = tracker.playingInBackground.contains(name)
            let goal = browser?.goal(app: name)
            menu.addItem(row((live ? "● " : playing ? "♪ " : "    ") + name, Self.duration(secs), goal: goal, goalSecs: secs))
        }
        if apps.count > 10 {
            let more = NSMenuItem(title: "More apps", action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for (name, secs) in apps.dropFirst(10) { sub.addItem(row(name, Self.duration(secs))) }
            more.submenu = sub
            menu.addItem(more)
        }
        if apps.isEmpty { menu.addItem(info("Nothing tracked yet today.")) }
        menu.addItem(.separator())

        // Browser (from the extension)
        if let b = browser, Date().timeIntervalSince(b.date) < Self.browserFresh, b.day == tracker.day {
            if !b.limits.isEmpty {
                menu.addItem(header("Daily limits"))
                for l in b.limits { menu.addItem(row(l.name, limitText(l))) }
                menu.addItem(.separator())
            }
            let sites = b.sites.sorted { $0.value > $1.value }
            menu.addItem(header("Today in the browser — \(Self.duration(sites.reduce(0) { $0 + $1.value }))"))
            for (host, secs) in sites.prefix(8) {
                let goal = b.goal(site: host)
                menu.addItem(row("    " + host, Self.duration(secs), goal: goal, goalSecs: goal.map { b.siteSeconds($0.name) } ?? secs))
            }
            if sites.isEmpty { menu.addItem(info("No websites yet today.")) }
        } else {
            menu.addItem(header("Browser"))
            let hint = Store.loadBrowser() == nil
                ? "Not connected to the TimeLock extension"
                : "The TimeLock extension hasn't checked in for a few minutes"
            menu.addItem(info(hint))
            menu.addItem(item("Get the TimeLock Extension…", #selector(openGitHub)))
            if linkedBrowsers.isEmpty {
                menu.addItem(info("No supported browser found (Chrome, Brave, Edge, Vivaldi)"))
            }
        }
        menu.addItem(.separator())

        if Store.loadBrowser() != nil {
            menu.addItem(item("Open TimeLock in the Browser", #selector(openExtensionPopup)))
            menu.addItem(.separator())
        }
        let login = item("Open at Login", #selector(toggleOpenAtLogin))
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        if let m = Updater.shared.available {
            menu.addItem(item("⬆︎ Install Update to v\(m.version)…", #selector(checkForUpdates)))
        } else {
            menu.addItem(item(checking ? "Checking for Updates…" : "Check for Updates…", #selector(checkForUpdates)))
        }
        menu.addItem(item("Update Source…", #selector(editUpdateSource)))
        menu.addItem(item("TimeLock on GitHub", #selector(openGitHub)))
        menu.addItem(info("TimeLock for Mac v\(AppVersion.version)"))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit TimeLock", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    private func statusText() -> String {
        switch tracker.state {
        case .counting(let name):
            let bg = tracker.playingInBackground
            return "Counting: \(name)" + (bg.isEmpty ? "" : " + \(bg.joined(separator: ", ")) playing")
        case .away:
            let bg = tracker.playingInBackground
            return bg.isEmpty ? "Paused — away from the keyboard" : "Away — counting \(bg.joined(separator: ", ")) (playing)"
        case .screenLocked: return "Paused — screen locked"
        case .nothing: return "Paused"
        }
    }

    private func limitText(_ l: BrowserSnapshot.Limit) -> String {
        let now = Date().timeIntervalSince1970 * 1000
        if l.unlockedUntil > now { return "unlocked" }
        if l.locked { return "🔒 \(Self.duration(l.used)) — locked" }
        return "\(Self.duration(max(0, l.limit - l.used))) left"
    }

    static func duration(_ secs: Double) -> String {
        let m = Int(secs / 60)
        if m < 1 { return "\(Int(secs))s" }
        if m < 60 { return "\(m)m" }
        return String(format: "%dh %02dm", m / 60, m % 60)
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        i.isEnabled = true
        return i
    }

    private func header(_ title: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.boldSystemFont(ofSize: NSFont.smallSystemFontSize),
            .foregroundColor: NSColor.secondaryLabelColor,
        ])
        i.isEnabled = false
        return i
    }

    private func info(_ title: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.isEnabled = false
        return i
    }

    /// Goal colours, the same as the extension: blue below the minimum, green
    /// once it's met, amber near the maximum, red past it.
    private static func color(_ state: BrowserSnapshot.GoalState) -> NSColor {
        switch state {
        case .none: return .secondaryLabelColor
        case .under: return .systemBlue
        case .met: return .systemGreen
        case .near: return .systemOrange
        case .over: return .systemRed
        }
    }

    private static func goalText(_ g: BrowserSnapshot.Goal) -> String {
        switch (g.min, g.max) {
        case let (lo?, hi?): return "Goal: \(duration(lo * 60))–\(duration(hi * 60)) a day"
        case let (lo?, nil): return "Goal: at least \(duration(lo * 60)) a day"
        case let (nil, hi?): return "Goal: at most \(duration(hi * 60)) a day"
        default: return ""
        }
    }

    /// "Name ........ 12m" with the time right-aligned, coloured by its goal.
    private func row(_ left: String, _ right: String, goal: BrowserSnapshot.Goal? = nil, goalSecs: Double = 0) -> NSMenuItem {
        let state = goal?.state(goalSecs) ?? .none
        let style = NSMutableParagraphStyle()
        style.tabStops = [NSTextTab(textAlignment: .right, location: 300)]
        let text = NSMutableAttributedString(string: "\(left)\t", attributes: [
            .font: NSFont.menuFont(ofSize: 0), .paragraphStyle: style, .foregroundColor: NSColor.labelColor,
        ])
        text.append(NSAttributedString(string: right, attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: state == .none ? .regular : .semibold),
            .paragraphStyle: style, .foregroundColor: Self.color(state),
        ]))
        let i = NSMenuItem(title: left, action: #selector(noop), keyEquivalent: "")
        i.target = self
        i.attributedTitle = text
        if let goal { i.toolTip = Self.goalText(goal) }
        return i
    }

    @objc private func noop() {}

    private func refreshIcon() {
        let symbol: String
        let label: String
        if ErrorReporter.shared.pending != nil {
            symbol = "exclamationmark.triangle"; label = "TimeLock — problem"
        } else if Updater.shared.available != nil {
            symbol = "arrow.down.circle"; label = "TimeLock — update available"
        } else if case .counting = tracker.state {
            symbol = "hourglass"; label = "TimeLock"
        } else {
            symbol = "hourglass.bottomhalf.filled"; label = "TimeLock — paused"
        }
        statusItem?.button?.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        statusItem?.button?.toolTip = label
    }

    // MARK: - Actions

    @objc private func toggleOpenAtLogin() {
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled { try service.unregister() } else { try service.register() }
        } catch {
            ErrorReporter.shared.report(AppError(.loginItemFailed, error.localizedDescription),
                                        surface: .alert, title: "Couldn't change Open at Login")
        }
    }

    @objc private func openGitHub() {
        if let url = URL(string: Self.repoURL) { NSWorkspace.shared.open(url) }
    }

    @objc private func showPendingProblem() {
        guard let p = ErrorReporter.shared.pending else { return }
        ErrorReporter.shared.clearPending()
        ErrorReporter.shared.present(p, title: "TimeLock ran into a problem")
    }

    // MARK: - Updates (same flow as PasteStack and Curtain)

    private var checking = false

    @objc private func checkForUpdates() {
        if let m = Updater.shared.available {
            offerInstall(m)
            return
        }
        checking = true
        Updater.shared.check { [weak self] result in
            guard let self else { return }
            self.checking = false
            self.refreshIcon()
            switch result {
            case .success(let m?):
                self.offerInstall(m)
            case .success(nil):
                let alert = NSAlert()
                alert.messageText = "TimeLock is up to date"
                alert.informativeText = "You're running v\(AppVersion.version), the newest version available."
                NSApp.activate(ignoringOtherApps: true)
                alert.runModal()
            case .failure(let error):
                self.showUpdateError(error)
            }
        }
    }

    private func offerInstall(_ m: UpdateManifest) {
        let alert = NSAlert()
        alert.messageText = "Update to TimeLock v\(m.version)?"
        var info = "You have v\(AppVersion.version)."
        if let notes = m.notes, !notes.isEmpty { info += "\n\nWhat's new:\n\(notes)" }
        info += "\n\nTimeLock will quit, update itself and reopen. Your tracked time is kept. "
            + "TimeLock needs no permissions, so there's nothing to re-grant."
        alert.informativeText = info
        alert.addButton(withTitle: "Install and Relaunch")
        alert.addButton(withTitle: "Later")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        tracker.tick()
        tracker.save()
        Updater.shared.install(m) { [weak self] error in
            self?.refreshIcon()
            self?.showUpdateError(error)
        }
    }

    private func showUpdateError(_ error: Error) {
        let e = AppError(wrapping: error)
        ErrorReporter.shared.log(e)
        let sourceProblem = e.code == .noUpdateSource || e.code == .badUpdateSource
        let picked = ErrorReporter.shared.present(e, title: "Couldn't update TimeLock",
                                                  actions: sourceProblem ? ["Set Update Source…"] : [])
        if picked == 0 { editUpdateSource() }
    }

    /// The swap script leaves a coded marker when installing an update fails
    /// and it has put the previous version back.
    private func reportFailedUpdateIfAny() {
        let marker = Updater.swapFailureMarker
        guard let text = try? String(contentsOf: marker, encoding: .utf8) else { return }
        try? FileManager.default.removeItem(at: marker)
        let parts = text.split(separator: "|", maxSplits: 1).map(String.init)
        let code = parts.first.flatMap { ErrorCode(rawValue: $0.trimmingCharacters(in: .whitespacesAndNewlines)) }
            ?? .updateSwapFailed
        ErrorReporter.shared.report(AppError(code, parts.count > 1 ? parts[1] : nil),
                                    surface: .alert, title: "Couldn't install the update")
    }

    @objc private func editUpdateSource() {
        let alert = NSAlert()
        alert.messageText = "Update Source"
        alert.informativeText = "Where TimeLock looks for new versions: a web link or a file path to a latest.json feed. "
            + "Leave it empty to use the built-in source"
            + (AppVersion.updateFeed.isEmpty ? " (none in this build)." : ":\n\(AppVersion.updateFeed)")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 380, height: 24))
        field.stringValue = UserDefaults.standard.string(forKey: "updateFeed") ?? ""
        field.placeholderString = AppVersion.updateFeed.isEmpty ? "https://…/latest.json" : AppVersion.updateFeed
        alert.accessoryView = field
        alert.addButton(withTitle: "Save")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let value = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty && Updater.url(from: value) == nil {
            showUpdateError(AppError(.badUpdateSource, value))
            return
        }
        Updater.shared.feed = value
        Updater.shared.check { _ in }
    }
}
