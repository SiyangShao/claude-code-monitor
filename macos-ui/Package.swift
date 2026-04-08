// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ClaudeCodeMonitor",
    platforms: [
        .macOS(.v14)
    ],
    targets: [
        .executableTarget(
            name: "ClaudeCodeMonitor",
            path: "Sources/ClaudeCodeMonitor"
        )
    ]
)
