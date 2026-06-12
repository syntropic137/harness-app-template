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

/// Strip one layer of matching surrounding quotes. Single-quoted interiors
/// are literal; double-quoted interiors additionally have the writer's
/// escape sequences reversed (dotenv semantics). Unquoted input is
/// returned as-is.
fn unquote(v: &str) -> String {
    let bytes = v.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if first == b'\'' && last == b'\'' {
            return v[1..v.len() - 1].to_string();
        }
        if first == b'"' && last == b'"' {
            return unescape(&v[1..v.len() - 1]);
        }
    }
    v.to_string()
}

/// Reverse the escapes `quote` emits inside double quotes. Unknown escape
/// sequences keep their backslash so hand-written values are not mangled.
fn unescape(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    let mut chars = v.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some('$') => out.push('$'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// True when a value cannot be written bare on a `KEY=value` line: dotenv
/// readers and shells reinterpret whitespace, quotes, comment / substitution
/// markers, escapes, and line breaks unless the value is quoted.
fn needs_quoting(v: &str) -> bool {
    v.chars()
        .any(|c| c.is_whitespace() || matches!(c, '#' | '$' | '"' | '\'' | '\\' | '`' | '='))
}

/// Quote a value for a `KEY=value` line so it round-trips through `parse`
/// and stays literal under dotenv readers. Simple values stay bare. Values
/// free of single quotes and line breaks are single-quoted (fully literal,
/// no substitution, matching the injection-safe `source` convention).
/// Anything else is double-quoted with escapes that `unescape` reverses;
/// `$` is escaped so dotenv substitution cannot rewrite the value.
pub(crate) fn quote(v: &str) -> String {
    if !needs_quoting(v) {
        return v.to_string();
    }
    if !v.contains('\'') && !v.contains('\n') && !v.contains('\r') {
        return format!("'{v}'");
    }
    let mut out = String::with_capacity(v.len() + 2);
    out.push('"');
    for c in v.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '$' => out.push_str("\\$"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
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
                output.push_str(&format!("{k}={}\n", quote(val)));
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
            output.push_str(&format!("{k}={}\n", quote(v)));
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

    #[test]
    fn parse_handles_short_unquotable_values() {
        // A 1-char value can't be surrounded by a matching quote pair, so it
        // exercises the unquote fall-through (len < 2).
        let dir = TempDir::new().unwrap();
        let path = write_file(&dir, ".env", "A=x\nB=\n");
        let map = parse(&path);
        assert_eq!(map.get("A").map(String::as_str), Some("x"));
        assert_eq!(map.get("B").map(String::as_str), Some(""));
    }

    #[test]
    fn quote_then_parse_round_trips_special_values() {
        let dir = TempDir::new().unwrap();
        let values = [
            "plain",
            "",
            "a b",
            "has #comment",
            "it's quoted",
            "say \"hi\"",
            "$HOME and `cmd`",
            "back\\slash",
            "multi\nline",
            "tab\there",
            "a=b",
            "mixed 'single' and \"double\" with $var",
            "it's a\\b\t\r\nc \"q\" $v",
        ];
        for (i, v) in values.iter().enumerate() {
            let key = format!("K{i}");
            let path = write_file(&dir, &format!(".env{i}"), &format!("{key}={}\n", quote(v)));
            let map = parse(&path);
            assert_eq!(
                map.get(&key).map(String::as_str),
                Some(*v),
                "round trip failed for {v:?}"
            );
        }
    }

    #[test]
    fn parse_keeps_unknown_escapes_and_trailing_backslash_in_double_quotes() {
        let dir = TempDir::new().unwrap();
        let path = write_file(&dir, ".env", "A=\"\\q\"\nB=\"x\\\"\n");
        let map = parse(&path);
        assert_eq!(map.get("A").map(String::as_str), Some("\\q"));
        assert_eq!(map.get("B").map(String::as_str), Some("x\\"));
    }

    #[test]
    fn sync_preserves_special_value_through_write_and_read() {
        let dir = TempDir::new().unwrap();
        let example = write_file(&dir, ".env.example", "# Secret password\nPASSWORD=\n");
        let original = "p ss#w'rd say \"hi\" $HOME";
        let env = write_file(&dir, ".env", &format!("PASSWORD={}\n", quote(original)));
        let schema = ConfigFile {
            config: crate::schema::ConfigMeta {
                version: "1".into(),
                app_prefix: "T".into(),
            },
            vars: vec![crate::schema::Var {
                name: "PASSWORD".into(),
                description: "Secret password".into(),
                required: true,
                default: None,
                op_ref: None,
                secret: true,
            }],
        };
        // Two passes prove the write+read cycle is idempotent, not just lossless once.
        for _ in 0..2 {
            sync(&schema, &example, &env).unwrap();
            let map = parse(&env);
            assert_eq!(map.get("PASSWORD").map(String::as_str), Some(original));
        }
    }

    #[test]
    fn sync_quotes_archived_values() {
        let dir = TempDir::new().unwrap();
        let example = write_file(&dir, ".env.example", "FOO=\n");
        let env = write_file(&dir, ".env", "FOO=1\nGONE='a b #c'\n");
        let schema = ConfigFile {
            config: crate::schema::ConfigMeta {
                version: "1".into(),
                app_prefix: "T".into(),
            },
            vars: vec![crate::schema::Var {
                name: "FOO".into(),
                description: "Foo".into(),
                required: false,
                default: None,
                op_ref: None,
                secret: false,
            }],
        };
        sync(&schema, &example, &env).unwrap();
        let written = fs::read_to_string(&env).unwrap();
        assert!(written.contains("GONE='a b #c'"), "written:\n{written}");
        let map = parse(&env);
        assert_eq!(map.get("GONE").map(String::as_str), Some("a b #c"));
    }

    #[test]
    fn sync_passes_through_example_lines_without_equals() {
        // A hand-edited .env.example line with no '=' must survive sync verbatim.
        let dir = TempDir::new().unwrap();
        let example = write_file(&dir, ".env.example", "# header\nNOT_A_PAIR\nFOO=\n");
        let env = dir.path().join(".env").to_str().unwrap().to_string();
        let schema = ConfigFile {
            config: crate::schema::ConfigMeta {
                version: "1".into(),
                app_prefix: "T".into(),
            },
            vars: vec![],
        };
        sync(&schema, &example, &env).unwrap();
        let written = fs::read_to_string(&env).unwrap();
        assert!(written.contains("NOT_A_PAIR"), "written:\n{written}");
    }
}
