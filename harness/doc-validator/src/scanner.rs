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
    for line in content.lines() {
        let trimmed = line.trim_start();
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
}
