import CoreGraphics
import Foundation

// Prints the on-screen windows front to back as JSON lines: owner, layer and bounds.
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
for window in list {
  let owner = window[kCGWindowOwnerName as String] as? String ?? ""
  let layer = window[kCGWindowLayer as String] as? Int ?? 0
  let bounds = window[kCGWindowBounds as String] as? [String: Double] ?? [:]
  let line: [String: Any] = [
    "owner": owner, "layer": layer,
    "x": bounds["X"] ?? 0, "y": bounds["Y"] ?? 0,
    "width": bounds["Width"] ?? 0, "height": bounds["Height"] ?? 0,
  ]
  if let data = try? JSONSerialization.data(withJSONObject: line), let json = String(data: data, encoding: .utf8) {
    print(json)
  }
}
