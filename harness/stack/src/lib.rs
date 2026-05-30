// harness-stack — stub library entry point.
//
// The real `stack-manager` plugin will live here once the lab ships it. For
// now this exists so:
//   1. `cargo check` succeeds in the workspace (the workspace declares this
//      crate as a member per Cargo.toml#[workspace].members).
//   2. The crate has a public `is_stub()` helper that downstream tooling
//      (e.g., `harness/doctor`) can read to detect "the stack-manager plugin
//      is the bundled stub" without invoking the binary.
//
// See `src/main.rs` for the bin entry point's behavior + S1 r3.3 § C20 for
// the contract.

/// Returns `true` while this crate is the unconfigured stub. A real
/// stack-manager plugin replaces this whole crate (it does NOT keep
/// `is_stub() == true`); tooling can call this without compiling against
/// the real plugin's surface.
#[must_use]
pub const fn is_stub() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::is_stub;

    #[test]
    fn stub_marker_is_true() {
        assert!(is_stub(), "stub crate must report is_stub() == true");
    }
}
