// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenTerminalCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "OpenTerminalCore", targets: ["OpenTerminalCore"])],
    targets: [
        .target(name: "OpenTerminalCore"),
        .testTarget(name: "OpenTerminalCoreTests", dependencies: ["OpenTerminalCore"]),
        .target(name: "OpenTerminalAppModel", dependencies: ["OpenTerminalCore"], path: "App",
                exclude: ["OpenTerminalApp.swift", "TerminalViews.swift", "ResearchView.swift", "Info.plist", "OpenTerminal.entitlements", "PrivacyInfo.xcprivacy", "Assets.xcassets"],
                sources: ["TerminalModel.swift", "PhoneServices.swift"]),
        .testTarget(name: "OpenTerminalAppModelTests", dependencies: ["OpenTerminalAppModel", "OpenTerminalCore"])
    ]
)
