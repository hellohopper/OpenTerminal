// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpenTerminalCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "OpenTerminalCore", targets: ["OpenTerminalCore"])],
    targets: [
        .target(name: "OpenTerminalCore"),
        .testTarget(name: "OpenTerminalCoreTests", dependencies: ["OpenTerminalCore"])
    ]
)
