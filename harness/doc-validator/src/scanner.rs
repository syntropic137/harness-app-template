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
            let segment = &line[start..end];
            let mut cursor = 0;
            while let Some(open) = segment[cursor..].find("](") {
                let target_start = cursor + open + 2;
                let Some(close) = segment[target_start..].find(')') else {
                    break;
                };
                let target = segment[target_start..target_start + close].trim();
                if !target.is_empty() {
                    links.push(Link {
                        target: target.to_string(),
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
        for label in footnote_labels(trimmed) {
            if trimmed.starts_with(&format!("[^{label}]:")) {
                anchors.insert(format!("footnote-{label}"));
            } else {
                footnote_refs.insert(label);
            }
        }

        let Some(title) = trimmed.strip_prefix('#') else {
            continue;
        };
        if !trimmed.starts_with("# ") && !trimmed.starts_with("## ") && !trimmed.starts_with("### ")
        {
            continue;
        }
        let title = title.trim_start_matches('#').trim();
        if title.is_empty() {
            continue;
        }
        anchors.insert(slugify_heading(title));
    }
    for label in footnote_refs {
        anchors.insert(format!("footnote-ref-{label}-1"));
    }
    anchors
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
    } else if target.starts_with("http://")
        || target.starts_with("https://")
        || target.starts_with("mailto:")
        || target.starts_with("ftp://")
        || target.starts_with("data:")
        || target.starts_with("file://")
        || target.starts_with('/')
    {
        LinkKind::External
    } else {
        LinkKind::Relative
    }
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
    while let Some(start) = line[cursor..].find("[^") {
        let label_start = cursor + start + 2;
        let Some(end) = line[label_start..].find(']') else {
            break;
        };
        let label = &line[label_start..label_start + end];
        if !label.is_empty()
            && label
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        {
            labels.insert(label.to_string());
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
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].kind, LinkKind::Relative);
        assert_eq!(links[1].kind, LinkKind::Anchor);
    }

    #[test]
    fn skips_fenced_and_inline_code() {
        let links = extract_links("`[no](./no.md)`\n```\n[skip](./skip.md)\n```\n[yes](./yes.md)");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "./yes.md");
    }

    #[test]
    fn extracts_github_style_heading_anchors() {
        let anchors = extract_anchors("# ADR-0001: Stack Manager\n## Why this matters");
        assert!(anchors.contains("adr-0001-stack-manager"));
        assert!(anchors.contains("why-this-matters"));
    }

    #[test]
    fn extracts_footnote_definition_and_reference_anchors() {
        let anchors = extract_anchors("See note[^1].\n\n[^1]: detail");
        assert!(anchors.contains("footnote-1"));
        assert!(anchors.contains("footnote-ref-1-1"));
    }

    #[test]
    fn treats_site_root_links_as_external() {
        let links = extract_links("[home](/blog/post)");
        assert_eq!(links[0].kind, LinkKind::External);
    }

    #[test]
    fn handles_unclosed_links_and_split_prose_spans() {
        let links = extract_links("prefix `[no](./no.md)` [yes](./yes.md)\n[bad](./bad.md");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "./yes.md");
    }

    #[test]
    fn ignores_unsupported_empty_headings_and_unclosed_footnotes() {
        let anchors = extract_anchors("#### Too deep\n#No space\n##   \nBroken [^note");
        assert!(anchors.is_empty());
    }

    #[test]
    fn classifies_all_external_protocols() {
        let links = extract_links(
            "[http](http://example.com)\n[mail](mailto:test@example.com)\n[ftp](ftp://example.com)\n[data](data:text/plain,hi)\n[file](file:///tmp/a)",
        );
        assert!(links.iter().all(|link| link.kind == LinkKind::External));
    }
}
