import AppKit

// A plain text window that stands in for "the app in front" during the desktop test.
//   source "<text>" [all|none] [title] [fullscreen|window] [document]   selects all of the text, or nothing;
//   the window names the document's file, as an editor's does
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
let title = args.count > 3 ? args[3] : "Source"
let fullScreen = args.count > 4 && args[4] == "fullscreen"
let document = args.count > 5 ? args[5] : ""

// Full screen needs a window that can resize; the other runs keep the fixed window they always had.
let window = NSWindow(
  contentRect: NSRect(x: 200, y: 200, width: 1200, height: 700),
  styleMask: fullScreen ? [.titled, .resizable] : [.titled], backing: .buffered, defer: false)
if !document.isEmpty {
  window.representedURL = URL(fileURLWithPath: document)
}
window.title = title
if fullScreen {
  window.collectionBehavior = [.fullScreenPrimary]
}
let view = NSTextView(frame: NSRect(x: 0, y: 0, width: 1200, height: 700))
view.string = text
view.font = NSFont.systemFont(ofSize: 18)
window.contentView?.addSubview(view)
window.makeKeyAndOrderFront(nil)
window.makeFirstResponder(view)
view.setSelectedRange(NSRange(location: 0, length: selectAll ? (text as NSString).length : 0))
app.activate(ignoringOtherApps: true)
if fullScreen {
  window.toggleFullScreen(nil)
}
app.run()
