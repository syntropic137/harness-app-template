use std::path::PathBuf;
use std::process::Command;

fn binary_path() -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("target");
    path.push("debug");
    path.push("harness-doc-validator");
    path
}

#[test]
fn binary_exits_one_on_bad_manifest_cross_reference() {
    let tmp = tempfile::tempdir().unwrap();
    let adr_dir = tmp.path().join("docs/adrs");
    std::fs::create_dir_all(&adr_dir).unwrap();
    std::fs::write(
        adr_dir.join("README.md"),
        "## Index\n\n| Document | Description |\n|---|---|\n",
    )
    .unwrap();
    std::fs::write(adr_dir.join("CLAUDE.md"), "Use ADR-0001-demo backlinks.").unwrap();
    std::fs::write(adr_dir.join("AGENTS.md"), "Use ADR-0001-demo backlinks.").unwrap();
    std::fs::write(
        adr_dir.join("ADR-0001-demo.md"),
        "---\nname: Demo\ndescription: Demo\nstatus: accepted\n---\n\n# ADR-0001: Demo\n\n**Date:** 2026-05-30\n**Category:** Test\n\n## Context\n\n## Decision\n\n## Consequences\n",
    )
    .unwrap();
    std::fs::create_dir_all(tmp.path().join("docs/harness-engineering")).unwrap();
    std::fs::write(
        tmp.path().join("docs/harness-engineering/README.md"),
        "## Scope\n\n## Actionable\n\n## References\n",
    )
    .unwrap();
    std::fs::write(
        tmp.path()
            .join("docs/harness-engineering/lab-five-principles.md"),
        "# Principles\n",
    )
    .unwrap();
    std::fs::write(
        tmp.path().join("harness.manifest.json"),
        r#"{"slots":{"demo":{"decisionAt":"docs/adrs/ADR-9999-missing.md"}}}"#,
    )
    .unwrap();

    let output = Command::new(binary_path())
        .arg(tmp.path())
        .output()
        .expect("spawn harness-doc-validator");

    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("decisionAt target does not exist"));
}
