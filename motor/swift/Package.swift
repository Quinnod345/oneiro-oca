// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "oneiro-motor",
    platforms: [.macOS(.v14)],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "oneiro-motor",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("Cocoa"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("IOKit"),
            ]
        )
    ]
)
