import AppKit

/// Every failure a user can run into has a stable code, so it can be looked up
/// on the public error list (ERRORS.md, shared with the browser extension) or
/// pasted into an LLM. Add new codes here and to ERRORS.md together, and never
/// show a user an error without one. Codes are never reused or renumbered.
/// The extension uses TL-1xx to 5xx and TL-601; the Mac app uses 602 and up.
enum ErrorCode: String, CaseIterable {
    // 6xx — the Mac app: tracking, saved data, the browser connection
    case browserLinkFailed = "TL-602"
    case dataFolderUnavailable = "TL-603"
    case usageSaveFailed = "TL-604"
    case usageUnreadable = "TL-605"
    case loginItemFailed = "TL-606"
    case connectorFailed = "TL-607"
    case popupFailed = "TL-608"
    // 7xx — Mac app updates
    case noUpdateSource = "TL-701"
    case badUpdateSource = "TL-702"
    case updateSourceUnreachable = "TL-703"
    case updateServerError = "TL-704"
    case updateInfoMalformed = "TL-705"
    case updateDownloadFailed = "TL-706"
    case updateUnpackFailed = "TL-707"
    case updateMissingApp = "TL-708"
    case updateWrongApp = "TL-709"
    case updateDamagedApp = "TL-710"
    case updateInstallerFailed = "TL-711"
    case updateSwapFailed = "TL-712"
    // 8xx — reserved for the Install TimeLock.command script (release.sh)
    // 9xx — anything not covered above
    case unexpected = "TL-999"

    var summary: String {
        switch self {
        case .browserLinkFailed: return "Couldn't connect TimeLock to your browsers, so the extension can't see your app time."
        case .dataFolderUnavailable: return "Couldn't create TimeLock's data folder, so app time can't be saved."
        case .usageSaveFailed: return "Couldn't save the time you spent in apps."
        case .usageUnreadable: return "Your saved app time for today couldn't be read."
        case .loginItemFailed: return "Couldn't change Open at Login."
        case .connectorFailed: return "The browser extension sent TimeLock something it couldn't handle."
        case .popupFailed: return "Couldn't open the TimeLock popup in your browser."
        case .noUpdateSource: return "No update source is set."
        case .badUpdateSource: return "The update source isn't a web link or a file path."
        case .updateSourceUnreachable: return "Couldn't reach the update source."
        case .updateServerError: return "The update server returned an error."
        case .updateInfoMalformed: return "The update information is damaged or in the wrong format."
        case .updateDownloadFailed: return "Couldn't download the update."
        case .updateUnpackFailed: return "Couldn't unpack the downloaded update."
        case .updateMissingApp: return "The downloaded update doesn't contain TimeLock."
        case .updateWrongApp: return "The downloaded update is a different app."
        case .updateDamagedApp: return "The downloaded update is damaged."
        case .updateInstallerFailed: return "Couldn't start installing the update."
        case .updateSwapFailed: return "Installing the update failed, so the previous version was kept."
        case .unexpected: return "Something unexpected went wrong."
        }
    }

    var hint: String {
        switch self {
        case .browserLinkFailed:
            return "Check that ~/Library/Application Support is writable, then quit and reopen TimeLock. In the extension, click Check connection in Settings."
        case .dataFolderUnavailable, .usageSaveFailed:
            return "Check that your disk isn't full and that ~/Library/Application Support/TimeLock is writable."
        case .usageUnreadable:
            return "TimeLock started today's app time from zero. The unreadable file was kept next to it with “damaged” in the name."
        case .loginItemFailed:
            return "You can add TimeLock yourself in System Settings → General → Login Items."
        case .connectorFailed:
            return "Update both the extension and the Mac app to the latest version, then reload the extension."
        case .popupFailed:
            return "Check the browser is open and the TimeLock extension is enabled and up to date (2.3.0 or newer), then click again. Right-click the hourglass for the menu."
        case .noUpdateSource, .badUpdateSource:
            return "Set one with “Update Source…” in the menu, or leave it empty to use the built-in source."
        case .updateSourceUnreachable:
            return "Check your internet connection and try again."
        case .updateServerError, .updateDownloadFailed:
            return "Try again in a few minutes. If it keeps happening, download the latest version from GitHub."
        case .updateInfoMalformed, .updateUnpackFailed, .updateMissingApp, .updateWrongApp, .updateDamagedApp:
            return "The published update is broken. Download the latest version from GitHub instead."
        case .updateInstallerFailed, .updateSwapFailed:
            return "Make sure TimeLock is in ~/Applications and that the folder isn't locked, then try again."
        case .unexpected:
            return "Try again. If it keeps happening, copy the details and ask for help."
        }
    }
}

struct AppError: LocalizedError {
    let code: ErrorCode
    /// Technical specifics (paths, system error text). Never app or site names.
    let detail: String?

    init(_ code: ErrorCode, _ detail: String? = nil) {
        self.code = code
        self.detail = detail
    }

    init(wrapping error: Error, as code: ErrorCode = .unexpected) {
        if let e = error as? AppError { self = e } else { self.init(code, error.localizedDescription) }
    }

    var errorDescription: String? { "\(code.summary) (\(code.rawValue))" }
}

/// Logs every error to ~/Library/Application Support/TimeLock/errors.log and
/// shows it with its code: in an alert, or as a menu row for background failures.
final class ErrorReporter {
    enum Surface {
        case alert     // shown right away
        case menu      // "⚠️ Problem TL-xxx" row in the menu bar dropdown
        case logOnly   // e.g. an automatic update check while offline
    }

    static let shared = ErrorReporter()
    static let helpURL = "https://github.com/jonpikereally/TimeLock/blob/main/ERRORS.md"
    static let plainTextHelpURL = "https://raw.githubusercontent.com/jonpikereally/TimeLock/main/ERRORS.md"

    /// Hover text for anything that shows an error.
    static let tooltip = "Look up this error code on the TimeLock error list: \(helpURL)\n"
        + "You can also give that page and the copied error details to an AI assistant for help."

    private(set) var pending: AppError?
    var onChange: () -> Void = {}
    private var lastLogged: [ErrorCode: Date] = [:]

    static let logURL = Store.folder.appendingPathComponent("errors.log")

    func report(_ error: AppError, surface: Surface, title: String = "TimeLock ran into a problem") {
        if !Thread.isMainThread {
            DispatchQueue.main.async { self.report(error, surface: surface, title: title) }
            return
        }
        log(error)
        switch surface {
        case .alert: present(error, title: title)
        case .menu:
            pending = error
            onChange()
        case .logOnly: break
        }
    }

    func clearPending() {
        pending = nil
        onChange()
    }

    /// Shows the error with its code. `actions` become extra buttons; returns
    /// the index of the action picked, or nil for OK.
    @discardableResult
    func present(_ error: AppError, title: String, actions: [String] = []) -> Int? {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        var text = error.code.summary
        if let d = error.detail, !d.isEmpty { text += "\n\n\(d)" }
        text += "\n\n\(error.code.hint)\n\nError code: \(error.code.rawValue)"
        alert.informativeText = text
        alert.addButton(withTitle: "OK")
        for a in actions { alert.addButton(withTitle: a) }
        alert.addButton(withTitle: "Copy Error Details")
        alert.addButton(withTitle: "Open Error List")
        Self.addTooltips(to: alert)
        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        if response == actions.count + 1 {
            let pb = NSPasteboard.general
            pb.clearContents()
            pb.setString(Self.details(error), forType: .string)
            return nil
        }
        if response == actions.count + 2 {
            if let url = URL(string: Self.helpURL) { NSWorkspace.shared.open(url) }
            return nil
        }
        if response >= 1 && response <= actions.count { return response - 1 }
        return nil
    }

    static func addTooltips(to alert: NSAlert) {
        alert.layout()
        func walk(_ view: NSView) {
            if view is NSTextField { view.toolTip = tooltip }
            view.subviews.forEach(walk)
        }
        if let content = alert.window.contentView {
            content.toolTip = tooltip
            walk(content)
        }
    }

    /// Copyable report: everything needed to troubleshoot, nothing private.
    static func details(_ error: AppError) -> String {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        #if arch(arm64)
        let arch = "Apple Silicon"
        #else
        let arch = "Intel"
        #endif
        var lines = ["TimeLock for Mac error \(error.code.rawValue): \(error.code.summary)"]
        if let d = error.detail, !d.isEmpty { lines.append("Details: \(d)") }
        lines.append("Suggested fix: \(error.code.hint)")
        lines.append("TimeLock for Mac v\(AppVersion.version) (built \(AppVersion.built)), macOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion), \(arch)")
        lines.append("Time: \(ISO8601DateFormatter().string(from: Date()))")
        lines.append("Error code list: \(helpURL)")
        lines.append("Plain-text error list for AI assistants: \(plainTextHelpURL)")
        return lines.joined(separator: "\n")
    }

    func log(_ error: AppError) {
        // The same code repeating (e.g. a full disk failing every save) is
        // logged at most once a minute.
        let now = Date()
        if let last = lastLogged[error.code], now.timeIntervalSince(last) < 60 { return }
        lastLogged[error.code] = now
        Self.appendLog("\(ISO8601DateFormatter().string(from: now)) \(error.code.rawValue) v\(AppVersion.version) "
            + error.code.summary + (error.detail.map { " — \($0)" } ?? "") + "\n")
    }

    static func appendLog(_ line: String) {
        let url = logURL
        let fm = FileManager.default
        try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let size = (try? fm.attributesOfItem(atPath: url.path))?[.size] as? Int, size > 512 * 1024 {
            let old = url.deletingPathExtension().appendingPathExtension("old.log")
            try? fm.removeItem(at: old)
            try? fm.moveItem(at: url, to: old)
        }
        guard let data = line.data(using: .utf8) else { return }
        if let h = try? FileHandle(forWritingTo: url) {
            defer { try? h.close() }
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: data)
        } else {
            try? data.write(to: url)
        }
    }
}
