use crate::schema::ConfigFile;
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::fs;

pub fn parse(path: &str) -> HashMap<String, String> {
    let Ok(content) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    content
        .lines()
        .filter(|l| !l.trim().starts_with('#') && !l.trim().is_empty())
        .filter_map(parse_line)
        .collect()
}

/// Parse one `.env` line into a (key, value) pair, dotenv-style:
/// tolerate a leading `export `, trim whitespace around the key, and strip a
/// single layer of matching surrounding quotes from the value so `FOO="bar baz"`
/// and `FOO='bar'` round-trip as `bar baz` / `bar`. Whitespace inside quotes is
/// preserved; an unquoted value is trimmed.
fn parse_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    let line = line.strip_prefix("export ").unwrap_or(line);
    let (k, v) = line.split_once('=')?;
    let key = k.trim();
    if key.is_empty() {
        return None;
    }
    Some((key.to_string(), unquote(v.trim())))
}

/// Strip one layer of matching surrounding single or double quotes, preserving
/// the interior verbatim. Unquoted input is returned as-is.
fn unquote(v: &str) -> String {
    let bytes = v.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' || first == b'\'') && first == last {
            return v[1..v.len() - 1].to_string();
        }
    }
    v.to_string()
}

pub fn sync(schema: &ConfigFile, example_path: &str, env_path: &str) -> Result<()> {
    let existing = parse(env_path);
    let example = fs::read_to_string(example_path)?;
    let known: HashSet<&str> = schema.vars.iter().map(|v| v.name.as_str()).collect();

    let mut output = String::new();
    for line in example.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            output.push_str(line);
            output.push('\n');
            continue;
        }
        if let Some((k, _)) = line.split_once('=') {
            let k = k.trim();
            if let Some(val) = existing.get(k) {
                output.push_str(&format!("{k}={val}\n"));
            } else {
                output.push_str(line);
                output.push('\n');
            }
        } else {
            output.push_str(line);
            output.push('\n');
        }
    }

    let mut archived: Vec<_> = existing
        .iter()
        .filter(|(k, _)| !known.contains(k.as_str()))
        .collect();

    if !archived.is_empty() {
        archived.sort_by_key(|(k, _)| k.as_str());
        output.push_str("\n# ARCHIVED VARIABLES\n");
        for (k, v) in archived {
            output.push_str(&format!("{k}={v}\n"));
        }
    }

    fs::write(env_path, output)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_file(dir: &TempDir, name: &str, content: &str) -> String {
        let path = dir.path().join(name);
        fs::write(&path, content).unwrap();
        path.to_str().unwrap().to_string()
    }

    #[test]
    fn parse_reads_key_value_pairs() {
        let dir = TempDir::new().unwrap();
        let path = write_file(&dir, ".env", "FOO=bar\nBAZ=qux\n");
        let map = parse(&path);
        assert_eq!(map.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(map.get("BAZ").map(String::as_str), Some("qux"));
    }

    #[test]
    fn parse_skips_comments_and_blank_lines() {
        let dir = TempDir::new().unwrap();
        let path = write_file(&dir, ".env", "# comment\n\nFOO=bar\n");
        let map = parse(&path);
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("FOO").map(String::as_str), Some("bar"));
    }

    #[test]
    fn parse_returns_empty_map_for_missing_file() {
        let map = parse("/nonexistent/.env");
        assert!(map.is_empty());
    }

    #[test]
    fn parse_tolerates_export_prefix() {
        let dir = TempDir::new().unwrap();
        let path = write_file(&dir, ".env", "export FOO=bar\n");
        let map = parse(&path);
        assert_eq!(map.get("FOO").map(String::as_str), Some("bar"));
    }

    #[test]
    fn parse_strips_surrounding_quotes_and_preserves_inner_whitespace() {
        let dir = TempDir::new().unwrap();
        let path = write_file(
            &dir,
            ".env",
            "A=\"bar baz\"\nB='qux'\nC=plain\nD=\"$(id)\"\n",
        );
        let map = parse(&path);
        assert_eq!(map.get("A").map(String::as_str), Some("bar baz"));
        assert_eq!(map.get("B").map(String::as_str), Some("qux"));
        assert_eq!(map.get("C").map(String::as_str), Some("plain"));
        // Quote-stripping is literal; it does not evaluate the contents.
        assert_eq!(map.get("D").map(String::as_str), Some("$(id)"));
    }

    #[test]
    fn parse_skips_lines_with_empty_key() {
        let dir = TempDir::new().unwrap();
        let path = write_file(&dir, ".env", "=novalue\nFOO=bar\n");
        let map = parse(&path);
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("FOO").map(String::as_str), Some("bar"));
    }
}
