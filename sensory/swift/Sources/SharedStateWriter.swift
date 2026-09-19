import Foundation

func writeSharedStateSnapshot(_ state: [String: Any], to target: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: state)
    // Atomic writes replace an existing snapshot. moveItem refuses to replace
    // its destination, which left perception frozen after the first update.
    try data.write(to: target, options: .atomic)
}
