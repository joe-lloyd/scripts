// Count real windows per app across all Spaces (no permissions needed).
// Run: swift count-windows.swift
import CoreGraphics
import Foundation

guard let info = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID)
        as? [[String: Any]] else {
    print("Could not read window list")
    exit(1)
}

var counts: [String: Int] = [:]
for w in info {
    // layer 0 = normal windows; menus, status items, overlays sit on other layers
    guard let layer = w["kCGWindowLayer"] as? Int, layer == 0 else { continue }
    // skip tiny helper/phantom windows Electron apps keep around
    guard let bounds = w["kCGWindowBounds"] as? [String: Any],
          let width = bounds["Width"] as? Double,
          let height = bounds["Height"] as? Double,
          width > 80, height > 80 else { continue }
    let owner = w["kCGWindowOwnerName"] as? String ?? "?"
    counts[owner, default: 0] += 1
}

var total = 0
for (owner, n) in counts.sorted(by: { $0.value > $1.value }) {
    print("\(n)\t\(owner)")
    total += n
}
print("---\n\(total)\ttotal")
