use anyhow::{Context, Result, bail};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs;

#[derive(Debug, Deserialize)]
pub struct ConfigFile {
    pub config: ConfigMeta,
    #[serde(rename = "var", default)]
    pub vars: Vec<Var>,
}

#[derive(Debug, Deserialize)]
pub struct ConfigMeta {
    pub version: String,
    pub app_prefix: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Var {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub required: bool,
    pub default: Option<String>,
    pub op_ref: Option<String>,
    #[serde(default)]
    pub secret: bool,
}

pub fn load(path: &str) -> Result<ConfigFile> {
    let content = fs::read_to_string(path).with_context(|| format!("Failed to read {path}"))?;
    let schema: ConfigFile =
        toml::from_str(&content).with_context(|| format!("Failed to parse {path}"))?;
    validate(&schema).with_context(|| format!("Invalid schema in {path}"))?;
    Ok(schema)
}

/// True if `name` is a valid POSIX-ish env-var identifier: a leading letter or
/// underscore, then letters, digits, or underscores. Anything else can't be a
/// safe `export NAME=...` target and would corrupt codegen / source output.
fn is_valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Reject schemas that would produce unsafe or ambiguous output before any
/// codegen / resolve / source path runs: duplicate var names (last-wins
/// silently) and names that aren't valid env identifiers.
pub fn validate(schema: &ConfigFile) -> Result<()> {
    let mut seen: HashSet<&str> = HashSet::new();
    for var in &schema.vars {
        if !is_valid_env_name(&var.name) {
            bail!(
                "invalid env var name {:?}: must start with a letter or '_' and contain only letters, digits, or '_'",
                var.name
            );
        }
        if !seen.insert(var.name.as_str()) {
            bail!("duplicate var name {:?} in schema", var.name);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta() -> ConfigMeta {
        ConfigMeta {
            version: "1".into(),
            app_prefix: "APP".into(),
        }
    }

    fn var(name: &str) -> Var {
        Var {
            name: name.into(),
            description: String::new(),
            required: false,
            default: None,
            op_ref: None,
            secret: false,
        }
    }

    #[test]
    fn accepts_valid_unique_names() {
        let s = ConfigFile {
            config: meta(),
            vars: vec![var("FOO"), var("_BAR2"), var("baz_qux")],
        };
        assert!(validate(&s).is_ok());
    }

    #[test]
    fn rejects_duplicate_names() {
        let s = ConfigFile {
            config: meta(),
            vars: vec![var("FOO"), var("FOO")],
        };
        let err = validate(&s).unwrap_err().to_string();
        assert!(err.contains("duplicate"), "got: {err}");
    }

    #[test]
    fn rejects_invalid_names() {
        for bad in ["1FOO", "FO-O", "FO O", "", "FÖO", "$X"] {
            let s = ConfigFile {
                config: meta(),
                vars: vec![var(bad)],
            };
            assert!(validate(&s).is_err(), "expected {bad:?} to be rejected");
        }
    }
}
