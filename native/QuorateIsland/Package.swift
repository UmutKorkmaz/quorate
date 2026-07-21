// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "QuorateIsland",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "QuorateIsland",
            path: "Sources/QuorateIsland"
        )
    ]
)
