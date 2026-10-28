// swift-tools-version:5.5

import PackageDescription

let package = Package(
    name: "tauri-plugin-tabs",
    platforms: [
        .macOS(.v10_13),
        // WKWebsiteDataStore(forIdentifier:) — one isolated store per account — needs iOS 17.
        .iOS(.v17),
    ],
    products: [
        .library(
            name: "tauri-plugin-tabs",
            type: .static,
            targets: ["tauri-plugin-tabs"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-tabs",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources"),
        .testTarget(
            name: "PluginTests",
            dependencies: ["tauri-plugin-tabs"],
            path: "Tests/PluginTests"),
    ]
)
