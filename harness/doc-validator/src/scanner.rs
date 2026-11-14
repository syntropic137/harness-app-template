//! Markdown link and anchor extraction.

use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Link {
    pub target: String,
    pub line: usize,
    pub kind: LinkKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum LinkKind {
    Relative,
    Anchor,
    External,
}

pub fn extract_links(content: &str) -> Vec<Link> {
    let mut links = Vec::new();
    let mut in_fence = false;

    for (line_idx, line) in content.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        for (start, end) in prose_spans(line) {
            let segment = &line[start..end]; // ubs:ignore prose_spans offsets are at or just past an ASCII backtick, or a line end: char boundaries
            let mut cursor = 0;
            // ubs:ignore byte offsets from find() of ASCII delimiters, always char boundaries
            while let Some(open) = segment[cursor..].find("](") {
                let target_start = cursor + open + 2;
                // ubs:ignore byte offsets from find() of ASCII delimiters, always char boundaries
                let Some(close) = segment[target_start..].find(')') else {
                    break;
                };
                let target = segment[target_start..target_start + close].trim(); // ubs:ignore byte offsets from find() of ASCII delimiters, always char boundaries
                if !target.is_empty() {
                    links.push(Link {
                        target: target.to_string(), // ubs:ignore an owned String per result is the return value
                        line: line_idx + 1,
                        kind: classify(target),
                    });
                }
                cursor = target_start + close + 1;
            }
        }
    }

    links
}

pub fn extract_anchors(content: &str) -> BTreeSet<String> {
    let mut anchors = BTreeSet::new();
    let mut footnote_refs = BTreeSet::new();
    for line in content.lines() {
        let trimmed = line.trim_start();
        collect_footnote_anchors(trimmed, &mut anchors, &mut footnote_refs);
        if let Some(slug) = heading_slug(trimmed) {
            anchors.insert(slug);
        }
    }
    for label in footnote_refs {
        anchors.insert(format!("footnote-ref-{label}-1")); // ubs:ignore an owned String per result is the return value
    }
    anchors
}

/// Record footnote-definition anchors on `trimmed`, collecting the labels of
/// footnote references (which get their own anchors) into `footnote_refs`.
fn collect_footnote_anchors(
    trimmed: &str,
    anchors: &mut BTreeSet<String>,
    footnote_refs: &mut BTreeSet<String>,
) {
    for label in footnote_labels(trimmed) {
        // ubs:ignore one short prefix per footnote label
        if trimmed.starts_with(&format!("[^{label}]:")) {
            anchors.insert(format!("footnote-{label}")); // ubs:ignore an owned String per result is the return value
        } else {
            footnote_refs.insert(label);
        }
    }
}

/// Return the GitHub-style slug for an ATX heading line (levels 1-3), or
/// `None` if the line is not such a heading or has an empty title.
fn heading_slug(trimmed: &str) -> Option<String> {
    let title = trimmed.strip_prefix('#')?;
    if !trimmed.starts_with("# ") && !trimmed.starts_with("## ") && !trimmed.starts_with("### ") {
        return None;
    }
    let title = title.trim_start_matches('#').trim();
    if title.is_empty() {
        return None;
    }
    Some(slugify_heading(title))
}

fn prose_spans(line: &str) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut in_code = false;
    let mut start = 0;

    for (idx, byte) in line.bytes().enumerate() {
        if byte != b'`' {
            continue;
        }
        if in_code {
            in_code = false;
            start = idx + 1;
        } else {
            if start < idx {
                spans.push((start, idx));
            }
            in_code = true;
        }
    }

    if !in_code && start < line.len() {
        spans.push((start, line.len()));
    }

    spans
}

fn classify(target: &str) -> LinkKind {
    if target.starts_with('#') {
        LinkKind::Anchor
    } else if is_external_target(target) {
        LinkKind::External
    } else {
        LinkKind::Relative
    }
}

fn is_external_target(target: &str) -> bool {
    const SCHEMES: [&str; 6] = [
        "http://", "https://", "mailto:", "ftp://", "data:", "file://",
    ];
    target.starts_with('/') || SCHEMES.iter().any(|scheme| target.starts_with(scheme))
}

pub fn slugify_heading(heading: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;

    for ch in heading.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(ch);
        } else if ch.is_whitespace() || ch == '-' {
            pending_dash = true;
        }
    }

    slug
}

fn footnote_labels(line: &str) -> BTreeSet<String> {
    let mut labels = BTreeSet::new();
    let mut cursor = 0;
    // ubs:ignore byte offsets from find() of ASCII delimiters, always char boundaries
    while let Some(start) = line[cursor..].find("[^") {
        let label_start = cursor + start + 2;
        // ubs:ignore byte offsets from find() of ASCII delimiters, always char boundaries
        let Some(end) = line[label_start..].find(']') else {
            break;
        };
        let label = &line[label_start..label_start + end]; // ubs:ignore byte offsets from find() of ASCII delimiters, always char boundaries
        if !label.is_empty()
            && label
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        {
            labels.insert(label.to_string()); // ubs:ignore an owned String per result is the return value
        }
        cursor = label_start + end + 1;
    }
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_relative_and_anchor_links() {
        let links = extract_links("[a](./a.md)\n[top](#top)");
        assert_eq!(links.len(), 2); // ubs:ignore test oracle
        assert_eq!(links[0].kind, LinkKind::Relative); // ubs:ignore test oracle
        assert_eq!(links[1].kind, LinkKind::Anchor); // ubs:ignore test oracle
    }

    #[test]
    fn skips_fenced_and_inline_code() {
        let links = extract_links("`[no](./no.md)`\n```\n[skip](./skip.md)\n```\n[yes](./yes.md)");
        assert_eq!(links.len(), 1); // ubs:ignore test oracle
        assert_eq!(links[0].target, "./yes.md"); // ubs:ignore test oracle
    }

    #[test]
    fn extracts_github_style_heading_anchors() {
        let anchors = extract_anchors("# ADR-0001: Stack Manager\n## Why this matters");
        assert!(anchors.contains("adr-0001-stack-manager")); // ubs:ignore test oracle
        assert!(anchors.contains("why-this-matters")); // ubs:ignore test oracle
    }

    #[test]
    fn extracts_footnote_definition_and_reference_anchors() {
        let anchors = extract_anchors("See note[^1].\n\n[^1]: detail");
        assert!(anchors.contains("footnote-1")); // ubs:ignore test oracle
        assert!(anchors.contains("footnote-ref-1-1")); // ubs:ignore test oracle
    }

    #[test]
    fn treats_site_root_links_as_external() {
        let links = extract_links("[home](/blog/post)");
        assert_eq!(links[0].kind, LinkKind::External); // ubs:ignore test oracle
    }

    #[test]
    fn handles_malformed_links_and_code_boundaries() {
        let links = extract_links("[ok](./ok.md) `code` [broken](./missing\n[after](./after.md)");
        assert_eq!(links.len(), 2); // ubs:ignore test oracle
        assert_eq!(links[0].target, "./ok.md"); // ubs:ignore test oracle
        assert_eq!(links[1].target, "./after.md"); // ubs:ignore test oracle
    }

    #[test]
    fn ignores_empty_headings_and_unclosed_footnotes() {
        let anchors = extract_anchors("# \n[^missing\n#### Too Deep\n#NoSpace\n## Present");
        assert_eq!(anchors.len(), 1); // ubs:ignore test oracle
        assert!(anchors.contains("present")); // ubs:ignore test oracle
    }

    #[test]
    fn skips_links_with_an_empty_target() {
        let links = extract_links("[empty]() [blank](  ) [ok](./ok.md)");
        assert_eq!(links.len(), 1); // ubs:ignore test oracle
        assert_eq!(links[0].target, "./ok.md"); // ubs:ignore test oracle
    }

    #[test]
    fn footnote_labels_keep_only_non_empty_slug_labels() {
        let labels = footnote_labels("[^] [^bad label] [^under_score] [^ok-1]");
        assert_eq!(labels.into_iter().collect::<Vec<_>>(), ["ok-1"]); // ubs:ignore test oracle
    }

    /// `collect_links` (lib.rs) counts an external link without checking it;
    /// `validate` is its only caller, so the branch is driven from here.
    #[test]
    fn validate_counts_external_links_without_checking_them()
    -> Result<(), Box<dyn std::error::Error>> {
        let tmp = tempfile::tempdir()?;
        std::fs::write(
            tmp.path().join("page.md"),
            "[ext](https://example.com/x) [local](./missing.md)",
        )?;

        let report = crate::validate(tmp.path(), &[])?;

        assert_eq!(report.links.total_links, 2); // ubs:ignore test oracle
        assert_eq!(report.links.checked_links, 1); // ubs:ignore test oracle
        assert_eq!(report.links.broken.len(), 1); // ubs:ignore test oracle
        Ok(())
    }
}
