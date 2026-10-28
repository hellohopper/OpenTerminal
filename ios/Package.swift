// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenTerminalCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "OpenTerminalCore", targets: ["OpenTerminalCore"])],
    targets: [
        .target(name: "OpenTerminalCore"),
        .testTarget(name: "OpenTerminalCoreTests", dependencies: ["OpenTerminalCore"]),
        .testTarget(name: "OpenTerminalBackendTests", dependencies: ["OpenTerminalCore"]),
        .target(name: "OpenTerminalAppModel", dependencies: ["OpenTerminalCore"], path: "App",
                exclude: ["OpenTerminalApp.swift", "TerminalViews.swift", "ResearchView.swift", "Info.plist", "OpenTerminal.entitlements", "PrivacyInfo.xcprivacy", "Assets.xcassets", "en.lproj", "zh-Hans.lproj"],
                sources: ["TerminalModel.swift", "PhoneServices.swift", "ResearchModel.swift", "AlertDraft.swift", "AlertHistoryModel.swift"]),
        .testTarget(name: "OpenTerminalAppModelTests", dependencies: ["OpenTerminalAppModel", "OpenTerminalCore"])
    ]
)
