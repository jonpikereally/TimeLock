import AppKit

// Started by a browser for the extension: answer it and exit, no menu bar.
if Connector.isConnectorLaunch(CommandLine.arguments) {
    Connector.run()
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
