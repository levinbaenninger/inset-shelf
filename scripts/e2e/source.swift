import AppKit

// A plain text window that stands in for "the app in front" during the desktop test.
//   source "<text>" [all|none]   selects all of the text, or nothing
let app = NSApplication.shared
app.setActivationPolicy(.regular)

// Without an Edit menu Cmd+C does nothing in a bare AppKit app.
let mainMenu = NSMenu()
let appItem = NSMenuItem()
let editItem = NSMenuItem()
mainMenu.addItem(appItem)
mainMenu.addItem(editItem)
let editMenu = NSMenu(title: "Edit")
editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
editItem.submenu = editMenu
app.mainMenu = mainMenu

let args = CommandLine.arguments
let text = args.count > 1 ? args[1] : "Source text"
let selectAll = !(args.count > 2 && args[2] == "none")

let window = NSWindow(
  contentRect: NSRect(x: 200, y: 200, width: 1200, height: 700),
  styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Source"
let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 1200, height: 700))
view.string = text
view.font = NSFont.systemFont(ofSize: 18)
window.contentView?.addSubview(view)
window.makeKeyAndOrderFront(nil)
window.makeFirstResponder(view)
view.setSelectedRange(NSRange(location: 0, length: selectAll ? (text as NSString).length : 0))
app.activate(ignoringOtherApps: true)
app.run()
