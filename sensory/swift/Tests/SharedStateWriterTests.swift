import Foundation
import XCTest
@testable import oneiro_sensory

final class SharedStateWriterTests: XCTestCase {
    func testRepeatedIntegrationReplacesExistingSnapshot() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let target = directory.appendingPathComponent("perception.json")
        try writeSharedStateSnapshot(["timestamp": "old", "user_presence": "active"], to: target)
        try writeSharedStateSnapshot(["timestamp": "new", "user_presence": "away"], to: target)
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: target)) as? [String: String])
        XCTAssertEqual(state["timestamp"], "new")
        XCTAssertEqual(state["user_presence"], "away")
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["perception.json"])
    }
}
