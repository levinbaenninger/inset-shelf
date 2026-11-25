import CoreGraphics
import Foundation

// Real input events for the desktop test. Shift is posted as flag changes, as a keyboard does;
// System Events' "key down shift" posts none, so a key hook never sees it.
//   input move <x> <y> | click <x> <y> | drag <x1> <y1> <x2> <y2>
//   input double-shift [left|right] [hold-ms] [gap-ms] | capitals

let source = CGEventSource(stateID: .hidSystemState)
let args = Array(CommandLine.arguments.dropFirst())

func fail() -> Never {
  FileHandle.standardError.write("usage: see header of input.swift\n".data(using: .utf8)!)
  exit(64)
}

func number(_ index: Int) -> Double {
  guard index < args.count, let value = Double(args[index]) else { fail() }
  return value
}

func mouse(_ type: CGEventType, _ point: CGPoint) {
  CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
}

func shift(_ code: CGKeyCode, down: Bool) {
  let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)!
  event.type = .flagsChanged
  event.flags = down ? .maskShift : []
  event.post(tap: .cghidEventTap)
}

func key(_ code: CGKeyCode, flags: CGEventFlags) {
  for down in [true, false] {
    let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)!
    event.flags = flags
    event.post(tap: .cghidEventTap)
  }
}

guard let command = args.first else { fail() }

switch command {
case "move":
  mouse(.mouseMoved, CGPoint(x: number(1), y: number(2)))
case "click":
  let point = CGPoint(x: number(1), y: number(2))
  mouse(.mouseMoved, point)
  usleep(80_000)
  mouse(.leftMouseDown, point)
  usleep(40_000)
  mouse(.leftMouseUp, point)
case "drag":
  let from = CGPoint(x: number(1), y: number(2))
  let to = CGPoint(x: number(3), y: number(4))
  mouse(.mouseMoved, from)
  usleep(80_000)
  mouse(.leftMouseDown, from)
  for step in 1...20 {
    let t = Double(step) / 20
    mouse(.leftMouseDragged, CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t))
    usleep(12_000)
  }
  mouse(.leftMouseUp, to)
case "double-shift":
  let code: CGKeyCode = args.count > 1 && args[1] == "right" ? 60 : 56
  let hold = useconds_t((args.count > 2 ? Int(args[2]) ?? 60 : 60) * 1000)
  let gap = useconds_t((args.count > 3 ? Int(args[3]) ?? 120 : 120) * 1000)
  shift(code, down: true); usleep(hold); shift(code, down: false)
  usleep(gap)
  shift(code, down: true); usleep(hold); shift(code, down: false)
case "capitals":
  for _ in 0..<2 {
    shift(56, down: true); usleep(20_000)
    key(0, flags: .maskShift); usleep(20_000)
    shift(56, down: false); usleep(100_000)
  }
default:
  fail()
}
usleep(150_000)
