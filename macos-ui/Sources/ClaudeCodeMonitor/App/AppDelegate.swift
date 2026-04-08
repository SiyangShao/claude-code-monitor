import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private var globalMonitor: Any?
    private var localMonitor: Any?
    private var observationTask: Task<Void, Never>?

    let settings = AppSettings()
    lazy var store = SessionStore(settings: settings)

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide dock icon — tray-only app
        NSApp.setActivationPolicy(.accessory)

        // Create status bar item
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateStatusIcon(.idle)

        if let button = statusItem.button {
            button.action = #selector(togglePopover)
            button.target = self
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }

        // Create popover with manual dismiss control
        popover = NSPopover()
        popover.contentSize = NSSize(width: 320, height: 420)
        popover.behavior = .applicationDefined
        popover.animates = true
        popover.delegate = self

        let contentView = ContentView(store: store, settings: settings)
        popover.contentViewController = NSHostingController(rootView: contentView)

        // Observe worst status changes to update icon
        observationTask = Task { @MainActor in
            var lastStatus: SessionStatus = .idle
            while !Task.isCancelled {
                let current = store.worstStatus
                if current != lastStatus {
                    lastStatus = current
                    updateStatusIcon(current)
                    updateTooltip()
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }

        // Start polling
        store.startPolling()
    }

    func applicationWillTerminate(_ notification: Notification) {
        store.stopPolling()
        observationTask?.cancel()
        removeEventMonitors()
    }

    // MARK: - Status Icon

    private func updateStatusIcon(_ status: SessionStatus) {
        guard let button = statusItem.button else { return }

        let color: NSColor
        switch status {
        case .active: color = .systemGreen
        case .waiting: color = .systemOrange
        case .compacting: color = .systemBlue
        case .idle: color = .systemGray
        }

        let size: CGFloat = 18
        let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            color.setFill()
            let circleDiameter: CGFloat = 10
            let circleRect = NSRect(
                x: (rect.width - circleDiameter) / 2,
                y: (rect.height - circleDiameter) / 2,
                width: circleDiameter,
                height: circleDiameter
            )
            NSBezierPath(ovalIn: circleRect).fill()
            return true
        }
        image.isTemplate = false
        button.image = image
    }

    private func updateTooltip() {
        let counts = store.statusCounts
        let active = counts[.active] ?? 0
        let waiting = counts[.waiting] ?? 0
        let idle = counts[.idle] ?? 0
        statusItem.button?.toolTip = "Claude Monitor: \(active) active, \(waiting) waiting, \(idle) idle"
    }

    // MARK: - Event Monitors

    private func addEventMonitors() {
        // Global monitor: clicks outside the app → close popover
        globalMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            self?.closePopover()
        }

        // Local monitor: clicks on the status item while popover is open
        localMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] event in
            // If clicking the status item button, let togglePopover handle it
            if let button = self?.statusItem.button,
               event.window == button.window {
                return event
            }
            return event
        }
    }

    private func removeEventMonitors() {
        if let m = globalMonitor { NSEvent.removeMonitor(m); globalMonitor = nil }
        if let m = localMonitor { NSEvent.removeMonitor(m); localMonitor = nil }
    }

    // MARK: - NSPopoverDelegate

    func popoverDidShow(_ notification: Notification) {
        addEventMonitors()
    }

    func popoverDidClose(_ notification: Notification) {
        removeEventMonitors()
    }

    // MARK: - Popover

    private func showPopover() {
        guard let button = statusItem.button else { return }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)

        // Bring the popover window to front
        popover.contentViewController?.view.window?.makeKey()

        // Refresh data when opening
        Task { @MainActor in
            await store.fetchSessions()
        }
    }

    private func closePopover() {
        popover.performClose(nil)
    }

    @objc private func togglePopover(_ sender: Any?) {
        let event = NSApp.currentEvent

        // Right-click: show context menu
        if event?.type == .rightMouseUp {
            closePopover()
            showContextMenu()
            return
        }

        if popover.isShown {
            closePopover()
        } else {
            showPopover()
        }
    }

    private func showContextMenu() {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Settings...", action: #selector(openSettingsFromMenu), keyEquivalent: ","))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        // Clear menu so left-click works normally next time
        DispatchQueue.main.async { [weak self] in
            self?.statusItem.menu = nil
        }
    }

    @objc private func openSettingsFromMenu() {
        showPopover()
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }
}
