// Draws TimeLock's app icon (the menu bar's SF Symbol hourglass, white on the
// TimeLock blue) and writes Resources/AppIcon.icns plus a 1024 px PNG preview.
// Builds the .icns itself, so it needs neither iconutil nor sips.
// Run: swiftc -o /tmp/make-icon tools/make-icon.swift && /tmp/make-icon
import AppKit

func render(_ px: Int) -> Data {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: 1024, height: 1024) // draw in 1024-point space at any pixel size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    // macOS icon grid: an 824 pt rounded square centred in 1024, with a soft shadow.
    let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
    let path = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.3)
    shadow.shadowOffset = NSSize(width: 0, height: -10)
    shadow.shadowBlurRadius = 24
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    NSColor(red: 0.18, green: 0.36, blue: 0.92, alpha: 1).setFill()
    path.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGradient(starting: NSColor(red: 0.36, green: 0.53, blue: 1.0, alpha: 1),
               ending: NSColor(red: 0.15, green: 0.30, blue: 0.85, alpha: 1))!.draw(in: path, angle: -90)
    // The same symbol as the menu bar item.
    // Drawn as a plain (template) glyph, then tinted white, so it keeps the
    // menu bar's outlined look instead of filling in its layers.
    let config = NSImage.SymbolConfiguration(pointSize: 470, weight: .medium)
    let symbol = NSImage(systemSymbolName: "hourglass", accessibilityDescription: nil)!.withSymbolConfiguration(config)!
    let s = symbol.size
    let white = NSImage(size: s, flipped: false) { r in
        symbol.draw(in: r)
        NSColor.white.set()
        r.fill(using: .sourceAtop)
        return true
    }
    white.draw(in: NSRect(x: 512 - s.width / 2, y: 512 - s.height / 2, width: s.width, height: s.height))
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

// icns = "icns" + total length, then (type, length incl. 8-byte header, PNG) chunks.
let chunks: [(String, Int)] = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256),
                               ("ic09", 512), ("ic10", 1024), ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
func be32(_ v: Int) -> Data { var x = UInt32(v).bigEndian; return Data(bytes: &x, count: 4) }
var body = Data()
var cache: [Int: Data] = [:]
for (type, px) in chunks {
    let png = cache[px] ?? render(px)
    cache[px] = png
    body += type.data(using: .ascii)! + be32(png.count + 8) + png
}
let icns = "icns".data(using: .ascii)! + be32(body.count + 8) + body
let here = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ".")
try! icns.write(to: here.appendingPathComponent("Resources/AppIcon.icns"))
try! cache[1024]!.write(to: here.appendingPathComponent("Resources/AppIcon-1024.png"))
print("Wrote Resources/AppIcon.icns (\(icns.count) bytes)")
