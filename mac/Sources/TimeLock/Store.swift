import Foundation

/// What the browser extension last told us (written by the connector,
/// read by the menu). Times are in seconds, timestamps in JS milliseconds.
struct BrowserSnapshot: Codable {
    struct Limit: Codable {
        var name: String
        var domains: [String]
        var apps: [String]
        var limit: Double
        var used: Double
        var locked: Bool
        var unlockedUntil: Double
    }
    var at: Double
    var day: String
    var resetHour: Int
    var sites: [String: Double]
    var limits: [Limit]
    var version: String?

    var date: Date { Date(timeIntervalSince1970: at / 1000) }
}

/// Everything lives in ~/Library/Application Support/TimeLock/:
///   apps/<YYYY-MM-DD>.json  seconds per app for that day (written by the menu bar app)
///   browser.json            the extension's latest snapshot (written by the connector)
///   status.json             what's counting right now + today's totals, every 2 s (menu bar app)
/// Both processes only ever replace whole files atomically, so a reader never
/// sees half a write.
enum Store {
    static let folder: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("TimeLock", isDirectory: true)
    static let appsFolder = folder.appendingPathComponent("apps", isDirectory: true)
    static let browserFile = folder.appendingPathComponent("browser.json")
    /// Live status for other readers (Stream Deck plugin); see Tracker.writeStatus.
    static let statusFile = folder.appendingPathComponent("status.json")
    static let keepDays = 35

    static func ensureFolders() throws {
        do {
            try FileManager.default.createDirectory(at: appsFolder, withIntermediateDirectories: true)
        } catch {
            throw AppError(.dataFolderUnavailable, "\(appsFolder.path) — \(error.localizedDescription)")
        }
    }

    /// Same rule as the extension: the day starts at resetHour, so usage at
    /// 1 AM with a 4 AM reset belongs to the previous day.
    static func dayKey(_ date: Date, resetHour: Int) -> String {
        let cal = Calendar.current
        var d = date
        if cal.component(.hour, from: date) < resetHour { d = cal.date(byAdding: .day, value: -1, to: date) ?? date }
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    static func appsFile(_ day: String) -> URL { appsFolder.appendingPathComponent("\(day).json") }

    /// Today's app time. A damaged file is set aside (renamed with "damaged")
    /// when `repair` is true; the connector only reads, so it passes false.
    static func loadApps(_ day: String, repair: Bool) throws -> [String: Double] {
        let url = appsFile(day)
        guard let data = try? Data(contentsOf: url) else { return [:] }
        do {
            return try JSONDecoder().decode([String: Double].self, from: data)
        } catch {
            if repair {
                let damaged = url.deletingPathExtension().appendingPathExtension("damaged-\(Int(Date().timeIntervalSince1970)).json")
                try? FileManager.default.moveItem(at: url, to: damaged)
            }
            throw AppError(.usageUnreadable, "\(url.lastPathComponent) — \(error.localizedDescription)")
        }
    }

    static func saveApps(_ day: String, _ usage: [String: Double]) throws {
        let url = appsFile(day)
        do {
            try ensureFolders()
            let data = try JSONEncoder().encode(usage)
            try writeAtomically(data, to: url)
        } catch let e as AppError {
            throw e
        } catch {
            throw AppError(.usageSaveFailed, "\(url.path) — \(error.localizedDescription)")
        }
    }

    /// Write next to the target, then rename over it: readers see the old
    /// file or the new one, never half of one.
    static func writeAtomically(_ data: Data, to url: URL) throws {
        let tmp = url.deletingLastPathComponent()
            .appendingPathComponent(".\(url.lastPathComponent).\(ProcessInfo.processInfo.processIdentifier).tmp")
        try data.write(to: tmp)
        guard rename(tmp.path, url.path) == 0 else {
            let err = String(cString: strerror(errno))
            try? FileManager.default.removeItem(at: tmp)
            throw CocoaError(.fileWriteUnknown, userInfo: [NSLocalizedDescriptionKey: "rename failed: \(err)"])
        }
    }

    static func loadBrowser() -> BrowserSnapshot? {
        guard let data = try? Data(contentsOf: browserFile) else { return nil }
        return try? JSONDecoder().decode(BrowserSnapshot.self, from: data)
    }

    static func saveBrowser(_ snap: BrowserSnapshot) throws {
        do {
            try ensureFolders()
            try writeAtomically(JSONEncoder().encode(snap), to: browserFile)
        } catch let e as AppError {
            throw e
        } catch {
            throw AppError(.usageSaveFailed, "\(browserFile.path) — \(error.localizedDescription)")
        }
    }

    /// The extension's "new day starts at" setting, so both count the same day.
    static var resetHour: Int { loadBrowser()?.resetHour ?? 0 }

    /// Every app seen in the last two weeks, for the extension's app picker.
    static func knownApps() -> [String] {
        var names = Set<String>()
        let files = (try? FileManager.default.contentsOfDirectory(at: appsFolder, includingPropertiesForKeys: nil)) ?? []
        let cutoff = dayKey(Date().addingTimeInterval(-14 * 86400), resetHour: 0)
        for f in files where f.pathExtension == "json" && !f.lastPathComponent.contains("damaged") {
            let day = f.deletingPathExtension().lastPathComponent
            guard day >= cutoff, let d = try? loadApps(day, repair: false) else { continue }
            names.formUnion(d.keys)
        }
        return names.sorted()
    }

    static func pruneOldDays() {
        let cutoff = dayKey(Date().addingTimeInterval(-Double(keepDays) * 86400), resetHour: 0)
        let files = (try? FileManager.default.contentsOfDirectory(at: appsFolder, includingPropertiesForKeys: nil)) ?? []
        for f in files where String(f.lastPathComponent.prefix(10)) < cutoff {
            try? FileManager.default.removeItem(at: f)
        }
    }
}
