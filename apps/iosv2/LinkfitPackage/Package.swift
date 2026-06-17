// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LinkfitPackage",
    defaultLocalization: "az",
    // macOS is declared only so the non-UI modules (AppCore/Models/Networking/
    // Persistence) and their tests compile & run on the host for a fast CI loop;
    // the UI modules (DesignSystem/Feature*) are exercised via xcodebuild on iOS.
    platforms: [.iOS(.v18), .macOS(.v13)],
    products: [
        .library(name: "AppCore", targets: ["AppCore"]),
        .library(name: "Models", targets: ["Models"]),
        .library(name: "Networking", targets: ["Networking"]),
        .library(name: "Persistence", targets: ["Persistence"]),
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
        .library(name: "FeatureAuth", targets: ["FeatureAuth"]),
        .library(name: "FeatureHome", targets: ["FeatureHome"]),
        .library(name: "FeatureGames", targets: ["FeatureGames"]),
        .library(name: "FeatureVenues", targets: ["FeatureVenues"]),
        .library(name: "FeatureProfile", targets: ["FeatureProfile"]),
        .library(name: "FeatureChat", targets: ["FeatureChat"]),
    ],
    targets: [
        // MARK: Foundation layer (leaf modules import nothing else in-package)
        .target(name: "AppCore"),
        .target(name: "Models"),

        .target(name: "Networking", dependencies: ["Models", "AppCore"]),
        .target(name: "Persistence", dependencies: ["Models", "AppCore"]),
        .target(name: "DesignSystem", dependencies: ["AppCore"]),

        // MARK: Feature layer — depend DOWN only, never on each other
        .target(name: "FeatureAuth", dependencies: ["DesignSystem", "Networking", "Persistence", "Models", "AppCore"]),
        .target(name: "FeatureHome", dependencies: ["DesignSystem", "Networking", "Persistence", "Models", "AppCore"]),
        .target(name: "FeatureGames", dependencies: ["DesignSystem", "Networking", "Persistence", "Models", "AppCore"]),
        .target(name: "FeatureVenues", dependencies: ["DesignSystem", "Networking", "Persistence", "Models", "AppCore"]),
        .target(name: "FeatureProfile", dependencies: ["DesignSystem", "Networking", "Persistence", "Models", "AppCore"]),
        .target(name: "FeatureChat", dependencies: ["DesignSystem", "Networking", "Persistence", "Models", "AppCore"]),

        // MARK: Tests
        .testTarget(name: "AppCoreTests", dependencies: ["AppCore"]),
        .testTarget(name: "NetworkingTests", dependencies: ["Networking", "Models", "AppCore"]),
        .testTarget(name: "PersistenceTests", dependencies: ["Persistence", "Models"]),
        .testTarget(name: "DesignSystemTests", dependencies: ["DesignSystem"]),
        .testTarget(name: "FeatureAuthTests", dependencies: ["FeatureAuth", "Models"]),
    ]
)
