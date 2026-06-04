//! Markdown cross-reference checking.

use crate::scanner::{Link, LinkKind, extract_anchors};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct BrokenLink {
    pub source: PathBuf,
    pub line: usize,
    pub target: String,
    pub reason: String,
    pub resolved: PathBuf,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CheckReport {
    pub broken: Vec<BrokenLink>,
    pub total_links: usize,
    pub checked_links: usize,
}

pub fn check_links(source: &Path, links: &[Link]) -> Vec<BrokenLink> {
    let mut broken = Vec::new();
    let base = source.parent().unwrap_or(Path::new(""));

    for link in links {
        if link.kind == LinkKind::External {
            continue;
        }

        let (path_part, anchor_part) = split_target(&link.target);
        let resolved = if path_part.is_empty() {
            source.to_path_buf()
        } else {
            base.join(path_part)
        };

        if !resolved.exists() {
            broken.push(BrokenLink {
                source: source.to_path_buf(),
                line: link.line,
                target: link.target.clone(),
                reason: "target file not found".to_string(),
                resolved,
            });
            continue;
        }

        if let Some(anchor) = anchor_part {
            if resolved.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&resolved) else {
                continue;
            };
            let anchors = extract_anchors(&content);
            if !anchor_exists(anchor, &anchors) {
                broken.push(BrokenLink {
                    source: source.to_path_buf(),
                    line: link.line,
                    target: link.target.clone(),
                    reason: format!("anchor #{anchor} not found"),
                    resolved,
                });
            }
        }
    }

    broken
}

fn split_target(target: &str) -> (&str, Option<&str>) {
    let target = target.split('?').next().unwrap_or(target);
    let mut parts = target.splitn(2, '#');
    let path = parts.next().unwrap_or("");
    let anchor = parts.next().filter(|anchor| !anchor.is_empty());
    (path, anchor)
}

fn anchor_exists(anchor: &str, anchors: &BTreeSet<String>) -> bool {
    anchors.contains(anchor) || anchors.contains(&anchor.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::extract_links;
    use std::fs;

    #[test]
    fn passes_when_target_and_anchor_exist() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("a.md");
        let target = tmp.path().join("b.md");
        fs::write(&source, "[b](./b.md#target-section)").unwrap();
        fs::write(&target, "## Target Section").unwrap();

        let content = fs::read_to_string(&source).unwrap();
        let broken = check_links(&source, &extract_links(&content));

        assert!(broken.is_empty());
    }

    #[test]
    fn reports_missing_anchor() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("a.md");
        let target = tmp.path().join("b.md");
        fs::write(&source, "[b](./b.md#missing)").unwrap();
        fs::write(&target, "## Present").unwrap();

        let content = fs::read_to_string(&source).unwrap();
        let broken = check_links(&source, &extract_links(&content));

        assert_eq!(broken.len(), 1);
        assert_eq!(broken[0].reason, "anchor #missing not found");
    }

    #[test]
    fn reports_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("a.md");
        fs::write(&source, "[ghost](./ghost.md)").unwrap();

        let content = fs::read_to_string(&source).unwrap();
        let broken = check_links(&source, &extract_links(&content));

        assert_eq!(broken.len(), 1);
        assert_eq!(broken[0].reason, "target file not found");
    }

    #[test]
    fn ignores_external_links() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("a.md");
        fs::write(&source, "[web](https://example.com)").unwrap();

        let content = fs::read_to_string(&source).unwrap();
        let broken = check_links(&source, &extract_links(&content));

        assert!(broken.is_empty());
    }

    #[test]
    fn checks_anchor_inside_same_file() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("a.md");
        fs::write(&source, "# Local\n\n[local](#local)").unwrap();

        let content = fs::read_to_string(&source).unwrap();
        let broken = check_links(&source, &extract_links(&content));

        assert!(broken.is_empty());
    }

    #[test]
    fn skips_anchor_validation_for_non_markdown_targets_and_unreadable_markdown() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("a.md");
        let text_target = tmp.path().join("data.txt");
        let unreadable_markdown = tmp.path().join("folder.md");
        fs::write(
            &source,
            "[text](./data.txt#ignored)\n[dir](./folder.md#ignored)",
        )
        .unwrap();
        fs::write(&text_target, "not markdown").unwrap();
        fs::create_dir(&unreadable_markdown).unwrap();

        let content = fs::read_to_string(&source).unwrap();
        let broken = check_links(&source, &extract_links(&content));

        assert!(broken.is_empty());
    }
}
