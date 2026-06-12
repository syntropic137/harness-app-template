use crate::env_file;
use crate::schema::{ConfigFile, Var};
use anyhow::Result;
use std::fs;

/// True when a var's value must never appear in the committed
/// `.env.example`: either it is declared `secret = true` or it resolves
/// through 1Password (`op_ref`), so any default it carries is treated as
/// sensitive.
fn is_sensitive(var: &Var) -> bool {
    var.secret || var.op_ref.is_some()
}

pub fn generate(schema: &ConfigFile) -> String {
    let mut lines: Vec<String> = Vec::new();
    for var in &schema.vars {
        lines.push(format!("# {}", var.description));
        let mut markers: Vec<String> = Vec::new();
        if var.required {
            markers.push("[REQUIRED]".to_string());
        }
        if var.secret {
            markers.push("[SECRET]".to_string());
        }
        if let Some(op_ref) = &var.op_ref {
            markers.push(format!("1Password: {op_ref}"));
        }
        if !markers.is_empty() {
            lines.push(format!("# {}", markers.join(" | ")));
        }
        // Sensitive vars emit an empty stub, never their real default.
        let default = if is_sensitive(var) {
            ""
        } else {
            var.default.as_deref().unwrap_or("")
        };
        lines.push(format!("{}={}", var.name, env_file::quote(default)));
        lines.push(String::new());
    }
    lines.join("\n")
}

pub fn write_example(schema: &ConfigFile, path: &str) -> Result<()> {
    let content = generate(schema);
    fs::write(path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{ConfigFile, ConfigMeta, Var};

    fn make_schema(vars: Vec<Var>) -> ConfigFile {
        ConfigFile {
            config: ConfigMeta {
                version: "1".into(),
                app_prefix: "TEST".into(),
            },
            vars,
        }
    }

    fn make_var(
        name: &str,
        desc: &str,
        required: bool,
        default: Option<&str>,
        op_ref: Option<&str>,
    ) -> Var {
        Var {
            name: name.into(),
            description: desc.into(),
            required,
            default: default.map(str::to_owned),
            op_ref: op_ref.map(str::to_owned),
            secret: false,
        }
    }

    #[test]
    fn required_var_has_required_marker() {
        let schema = make_schema(vec![make_var("DB_URL", "Database URL", true, None, None)]);
        let out = generate(&schema);
        assert!(out.contains("# [REQUIRED]"), "output:\n{out}");
        assert!(out.contains("# Database URL"), "output:\n{out}");
        assert!(out.contains("DB_URL="), "output:\n{out}");
    }

    #[test]
    fn optional_var_with_default() {
        let schema = make_schema(vec![make_var(
            "LOG_LEVEL",
            "Log level",
            false,
            Some("info"),
            None,
        )]);
        let out = generate(&schema);
        assert!(!out.contains("[REQUIRED]"), "output:\n{out}");
        assert!(out.contains("LOG_LEVEL=info"), "output:\n{out}");
    }

    #[test]
    fn required_var_with_op_ref_includes_op_ref_in_marker() {
        let schema = make_schema(vec![make_var(
            "API_KEY",
            "API key",
            true,
            None,
            Some("op://vault/item/field"),
        )]);
        let out = generate(&schema);
        assert!(out.contains("# [REQUIRED] | 1Password: op://vault/item/field"));
    }

    #[test]
    fn optional_var_with_op_ref_includes_op_ref_comment_without_required_marker() {
        let schema = make_schema(vec![make_var(
            "OPT_KEY",
            "Optional key",
            false,
            None,
            Some("op://vault/item/opt"),
        )]);
        let out = generate(&schema);
        assert!(out.contains("# 1Password: op://vault/item/opt"));
        assert!(!out.contains("[REQUIRED]"));
    }

    #[test]
    fn secret_var_with_default_emits_stub_not_value() {
        let mut var = make_var(
            "API_TOKEN",
            "API token",
            true,
            Some("real-secret-value"),
            None,
        );
        var.secret = true;
        let schema = make_schema(vec![var]);
        let out = generate(&schema);
        assert!(!out.contains("real-secret-value"), "output:\n{out}");
        assert!(out.contains("API_TOKEN=\n"), "output:\n{out}");
        assert!(out.contains("# [REQUIRED] | [SECRET]"), "output:\n{out}");
    }

    #[test]
    fn op_ref_var_with_default_emits_stub_not_value() {
        let schema = make_schema(vec![make_var(
            "OP_KEY",
            "1Password-backed key",
            false,
            Some("leaked-default"),
            Some("op://vault/item/field"),
        )]);
        let out = generate(&schema);
        assert!(!out.contains("leaked-default"), "output:\n{out}");
        assert!(out.contains("OP_KEY=\n"), "output:\n{out}");
        assert!(
            out.contains("# 1Password: op://vault/item/field"),
            "output:\n{out}"
        );
    }

    #[test]
    fn non_secret_default_with_spaces_is_quoted() {
        let schema = make_schema(vec![make_var(
            "GREETING",
            "Greeting text",
            false,
            Some("hello world"),
            None,
        )]);
        let out = generate(&schema);
        assert!(out.contains("GREETING='hello world'"), "output:\n{out}");
    }

    #[test]
    fn vars_are_separated_by_blank_lines() {
        let schema = make_schema(vec![
            make_var("A", "First", false, Some("1"), None),
            make_var("B", "Second", false, Some("2"), None),
        ]);
        let out = generate(&schema);
        assert!(out.contains("\n\n"), "output:\n{out}");
    }
}
