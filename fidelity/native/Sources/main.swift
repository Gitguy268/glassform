// GlassformReference: renders the fidelity scenes with SwiftUI's native
// .glassEffect(), captures each window with ScreenCaptureKit, and dumps the
// glass filter parameters Core Animation uses. Also generates the shared
// background images.
//
//   GlassformReference --backgrounds <dir>
//   GlassformReference --capture --scenes <scenes.json> --backgrounds <dir> --out <dir>
//
// Launch through `open` (see build.sh / capture.sh) so macOS asks for Screen
// Recording permission for this app instead of for the terminal.

import AppKit
import CoreGraphics
import ImageIO
import ScreenCaptureKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Scene model

struct SceneFile: Decodable {
  let version: Int
  let scale: Int
  let scenes: [SceneSpec]
}

struct SceneSpec: Decodable {
  let id: String
  let size: [Double]
  let appearance: String
  let background: String
  let spacing: Double?
  let shapes: [ShapeSpec]
}

struct ShapeSpec: Decodable {
  let x: Double
  let y: Double
  let w: Double
  let h: Double
  let shape: String
  let radius: Double?
  let variant: String
  let tint: String?
}

// MARK: - Logging

var logLines: [String] = []
var logURL: URL?

func log(_ message: String) {
  print(message)
  logLines.append(message)
  if let logURL {
    try? logLines.joined(separator: "\n").appending("\n").write(to: logURL, atomically: true, encoding: .utf8)
  }
}

// MARK: - Backgrounds

let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

func hexColor(_ hex: String) -> (CGFloat, CGFloat, CGFloat, CGFloat) {
  var s = hex.trimmingCharacters(in: .whitespaces)
  if s.hasPrefix("#") { s.removeFirst() }
  var value: UInt64 = 0
  Scanner(string: s).scanHexInt64(&value)
  if s.count == 8 {
    return (CGFloat((value >> 24) & 0xff) / 255, CGFloat((value >> 16) & 0xff) / 255, CGFloat((value >> 8) & 0xff) / 255, CGFloat(value & 0xff) / 255)
  }
  return (CGFloat((value >> 16) & 0xff) / 255, CGFloat((value >> 8) & 0xff) / 255, CGFloat(value & 0xff) / 255, 1)
}

func cg(_ hex: String) -> CGColor {
  let (r, g, b, a) = hexColor(hex)
  return CGColor(colorSpace: srgb, components: [r, g, b, a])!
}

func writePNG(_ image: CGImage, to url: URL) throws {
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
    throw NSError(domain: "png", code: 1)
  }
  CGImageDestinationAddImage(dest, image, nil)
  if !CGImageDestinationFinalize(dest) { throw NSError(domain: "png", code: 2) }
}

/// Deterministic PRNG so the "photo" background is identical on every run.
struct Lcg {
  var state: UInt64
  mutating func next() -> CGFloat {
    state = state &* 6364136223846793005 &+ 1442695040888963407
    return CGFloat((state >> 33) & 0xffffff) / CGFloat(0xffffff)
  }
}

func makeBackgrounds(dir: URL) throws {
  try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  let W = 720, H = 480, s: CGFloat = 2
  func draw(_ name: String, _ body: (CGContext) -> Void) throws {
    let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    // Top-left origin in points, like CSS.
    ctx.translateBy(x: 0, y: CGFloat(H))
    ctx.scaleBy(x: s, y: -s)
    body(ctx)
    try writePNG(ctx.makeImage()!, to: dir.appendingPathComponent("\(name).png"))
    log("background \(name)")
  }
  let w: CGFloat = 360, h: CGFloat = 240

  try draw("white") { $0.setFillColor(cg("#ffffff")); $0.fill(CGRect(x: 0, y: 0, width: w, height: h)) }
  try draw("black") { $0.setFillColor(cg("#000000")); $0.fill(CGRect(x: 0, y: 0, width: w, height: h)) }

  try draw("gradient") { ctx in
    let colors = ["#ff375f", "#ff9f0a", "#ffd60a", "#30d158", "#64d2ff", "#5e5ce6"].map(cg) as CFArray
    let gradient = CGGradient(colorsSpace: srgb, colors: colors, locations: nil)!
    ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: w, y: h), options: [])
  }

  try draw("stripes") { ctx in
    ctx.setFillColor(cg("#ffffff")); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    let columns = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#007aff", "#af52de"]
    for (i, c) in columns.enumerated() {
      ctx.setFillColor(cg(c)); ctx.fill(CGRect(x: CGFloat(i) * 60, y: 0, width: 30, height: h))
    }
    ctx.setFillColor(cg("#111111"))
    var y: CGFloat = 0
    while y < h { ctx.fill(CGRect(x: 0, y: y, width: w, height: 6)); y += 16 }
  }

  try draw("checker") { ctx in
    for row in 0..<15 {
      for col in 0..<23 {
        ctx.setFillColor(cg((row + col) % 2 == 0 ? "#d8d8d8" : "#6e6e6e"))
        ctx.fill(CGRect(x: CGFloat(col) * 16, y: CGFloat(row) * 16, width: 16, height: 16))
      }
    }
  }

  try draw("text") { ctx in
    ctx.setFillColor(cg("#ffffff")); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    let words = "Liquid glass bends the light behind it. The quick brown fox jumps over the lazy dog. 0123456789 "
    let font = CTFontCreateWithName("Helvetica" as CFString, 15, nil)
    for line in 0..<12 {
      let start = words.index(words.startIndex, offsetBy: (line * 7) % 40)
      let text = String((String(words[start...]) + words).prefix(46))
      let attr = NSAttributedString(string: text, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): cg(line % 3 == 0 ? "#0a3d91" : "#1c1c1e"),
      ])
      let ctLine = CTLineCreateWithAttributedString(attr)
      ctx.saveGState()
      ctx.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
      ctx.textPosition = CGPoint(x: 8, y: 18 + CGFloat(line) * 19.5)
      CTLineDraw(ctLine, ctx)
      ctx.restoreGState()
    }
  }

  try draw("photo") { ctx in
    let sky = CGGradient(colorsSpace: srgb, colors: [cg("#0b1d51"), cg("#3b2f7a"), cg("#f0806a")] as CFArray, locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(sky, start: .zero, end: CGPoint(x: 0, y: h), options: [])
    var rng = Lcg(state: 42)
    let palette = ["#ffb340", "#ff5e7e", "#3ee0c8", "#7d7aff", "#fff1a8"]
    for i in 0..<18 {
      let cx = rng.next() * w, cy = rng.next() * h, r = 18 + rng.next() * 70
      let c = cg(palette[i % palette.count])
      let g = CGGradient(colorsSpace: srgb, colors: [c, c.copy(alpha: 0)!] as CFArray, locations: [0, 1])!
      ctx.drawRadialGradient(g, startCenter: CGPoint(x: cx, y: cy), startRadius: 0, endCenter: CGPoint(x: cx, y: cy), endRadius: r, options: [])
    }
    ctx.setFillColor(cg("#ffffffd0"))
    for _ in 0..<60 {
      let cx = rng.next() * w, cy = rng.next() * h * 0.6, r = 0.6 + rng.next() * 1.6
      ctx.fillEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
    }
    ctx.setFillColor(cg("#120a24"))
    ctx.move(to: CGPoint(x: 0, y: h))
    for i in 0...12 { ctx.addLine(to: CGPoint(x: CGFloat(i) * 30, y: h - 40 - rng.next() * 50)) }
    ctx.addLine(to: CGPoint(x: w, y: h)); ctx.closePath(); ctx.fillPath()
  }
}

// MARK: - SwiftUI scene

extension Color {
  init(hex: String) {
    let (r, g, b, a) = hexColor(hex)
    self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
  }
}

struct GlassShape: View {
  let spec: ShapeSpec
  var glass: Glass {
    var g: Glass
    switch spec.variant {
    case "clear": g = .clear
    case "identity": g = .identity
    default: g = .regular
    }
    if let tint = spec.tint { g = g.tint(Color(hex: tint)) }
    return g
  }
  var body: some View {
    let base = Color.clear.frame(width: spec.w, height: spec.h)
    switch spec.shape {
    case "circle": base.glassEffect(glass, in: .circle)
    case "rect": base.glassEffect(glass, in: .rect(cornerRadius: spec.radius ?? 16))
    default: base.glassEffect(glass, in: .capsule)
    }
  }
}

struct SceneView: View {
  let scene: SceneSpec
  let background: NSImage
  var shapes: some View {
    ForEach(Array(scene.shapes.enumerated()), id: \.offset) { _, s in
      GlassShape(spec: s).padding(.leading, s.x).padding(.top, s.y)
    }
  }
  var body: some View {
    ZStack(alignment: .topLeading) {
      Image(nsImage: background).resizable().frame(width: scene.size[0], height: scene.size[1])
      if let spacing = scene.spacing {
        GlassEffectContainer(spacing: spacing) { ZStack(alignment: .topLeading) { shapes } }
      } else {
        shapes
      }
    }
    .frame(width: scene.size[0], height: scene.size[1], alignment: .topLeading)
    .environment(\.colorScheme, scene.appearance == "dark" ? .dark : .light)
  }
}

final class CaptureWindow: NSWindow {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { true }
}

// MARK: - Filter dump

func jsonValue(_ value: Any?) -> Any {
  guard let value else { return NSNull() }
  if let n = value as? NSNumber {
    return CFGetTypeID(n) == CFBooleanGetTypeID() ? n.boolValue : n.doubleValue
  }
  if let s = value as? String { return s }
  if CFGetTypeID(value as CFTypeRef) == CGColor.typeID {
    let c = value as! CGColor
    return ["color": c.components ?? [], "space": (c.colorSpace?.name as String?) ?? ""]
  }
  if let d = value as? Data, d.count % 4 == 0 {
    return d.withUnsafeBytes { Array($0.bindMemory(to: Float.self)).map(Double.init) }
  }
  if let v = value as? NSValue { return v.description }
  return String(describing: value)
}

func dumpFilters(_ layer: CALayer, path: String, into out: inout [[String: Any]]) {
  let here = "\(path)/\(type(of: layer))"
  for f in layer.filters ?? [] {
    let obj = f as AnyObject
    let name = (obj.value(forKey: "name") as? String) ?? "?"
    var inputs: [String: Any] = [:]
    for key in (obj.value(forKey: "inputKeys") as? [String]) ?? [] {
      inputs[key] = jsonValue(obj.value(forKey: key))
    }
    out.append(["layer": here, "filter": name, "inputs": inputs])
  }
  for sub in layer.sublayers ?? [] { dumpFilters(sub, path: here, into: &out) }
}

// MARK: - Capture

@MainActor
func capture(scenesURL: URL, backgroundsDir: URL, outDir: URL) async throws {
  let file = try JSONDecoder().decode(SceneFile.self, from: Data(contentsOf: scenesURL))
  try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
  var filterDump: [String: Any] = [:]
  let only = arg("--scene")

  for scene in file.scenes where only == nil || scene.id == only {
    guard let bg = NSImage(contentsOf: backgroundsDir.appendingPathComponent("\(scene.background).png")) else {
      log("missing background \(scene.background)"); continue
    }
    bg.size = NSSize(width: scene.size[0], height: scene.size[1])
    let rect = NSRect(x: 120, y: 160, width: scene.size[0], height: scene.size[1])
    let win = CaptureWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false)
    win.hasShadow = false
    win.isOpaque = true
    win.level = .floating
    win.appearance = NSAppearance(named: scene.appearance == "dark" ? .darkAqua : .aqua)
    win.contentView = NSHostingView(rootView: SceneView(scene: scene, background: bg))
    win.makeKeyAndOrderFront(nil)
    NSApp.activate()
    try await Task.sleep(nanoseconds: 900_000_000)

    var filters: [[String: Any]] = []
    if let layer = win.contentView?.layer { dumpFilters(layer, path: "", into: &filters) }
    filterDump[scene.id] = ["backingScale": win.backingScaleFactor, "filters": filters]

    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let scWindow = content.windows.first(where: { $0.windowID == CGWindowID(win.windowNumber) }) else {
      log("window not found for \(scene.id)"); win.close(); continue
    }
    let config = SCStreamConfiguration()
    config.width = Int(scene.size[0]) * file.scale
    config.height = Int(scene.size[1]) * file.scale
    config.showsCursor = false
    config.ignoreShadowsSingleWindow = true
    config.colorSpaceName = CGColorSpace.sRGB
    config.pixelFormat = kCVPixelFormatType_32BGRA
    let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: scWindow), configuration: config)
    try writePNG(image, to: outDir.appendingPathComponent("\(scene.id).png"))
    log("captured \(scene.id) \(image.width)x\(image.height) scale=\(win.backingScaleFactor) glassFilters=\(filters.filter { ($0["filter"] as? String) == "glassBackground" }.count)")
    win.orderOut(nil)
    win.close()
  }

  let info = ProcessInfo.processInfo.operatingSystemVersion
  let meta: [String: Any] = ["macOS": "\(info.majorVersion).\(info.minorVersion).\(info.patchVersion)", "scenes": filterDump]
  let data = try JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted, .sortedKeys])
  try data.write(to: outDir.appendingPathComponent("native-filters.json"))
}

// MARK: - Main

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

if let out = arg("--log") { logURL = URL(fileURLWithPath: out) }

if let dir = arg("--backgrounds"), !args.contains("--capture") {
  do { try makeBackgrounds(dir: URL(fileURLWithPath: dir)); exit(0) } catch { log("error: \(error)"); exit(1) }
}

guard args.contains("--capture"), let scenes = arg("--scenes"), let bgs = arg("--backgrounds"), let out = arg("--out") else {
  log("usage: GlassformReference --backgrounds <dir> | --capture --scenes <json> --backgrounds <dir> --out <dir>")
  exit(64)
}

if !CGPreflightScreenCaptureAccess() {
  CGRequestScreenCaptureAccess()
  log("NEEDS_PERMISSION: allow GlassformReference in System Settings > Privacy & Security > Screen & System Audio Recording, then run capture again.")
  exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
Task { @MainActor in
  do {
    try await capture(scenesURL: URL(fileURLWithPath: scenes), backgroundsDir: URL(fileURLWithPath: bgs), outDir: URL(fileURLWithPath: out))
    log("done")
    exit(0)
  } catch {
    log("error: \(error)")
    exit(1)
  }
}
app.run()
