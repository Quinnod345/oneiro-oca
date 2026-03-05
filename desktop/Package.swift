// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "OneiroApp",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "OneiroApp", targets: ["OneiroApp"])
    ],
    dependencies: [
        .package(url: "https://github.com/Alamofire/Alamofire.git", .upToNextMajor(from: "5.8.0"))
    ],
    targets: [
        .executableTarget(
            name: "OneiroApp",
            dependencies: ["Alamofire"],
            swiftSettings: [
                .enableUpcomingFeature("BareSlashRegexLiterals")
            ]
        )
    ]
)
