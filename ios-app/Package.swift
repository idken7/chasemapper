// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ChaseMapper",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(name: "ChaseMapper", targets: ["ChaseMapper"])
    ],
    dependencies: [
        .package(url: "https://github.com/socketio/socket.io-client-swift.git", from: "16.0.0")
    ],
    targets: [
        .target(
            name: "ChaseMapper",
            dependencies: [
                .product(name: "SocketIO", package: "socket.io-client-swift")
            ],
            path: "ChaseMapper"
        ),
        .testTarget(
            name: "ChaseMapperTests",
            dependencies: ["ChaseMapper"],
            path: "Tests/ChaseMapperTests"
        )
    ]
)

