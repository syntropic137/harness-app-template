pub mod env;
pub mod op;

use crate::schema::ConfigFile;
use anyhow::{Result, bail};
use std::collections::HashMap;

/// Names of `required` vars that did not resolve to a value, in schema order.
///
/// `resolve_all` deliberately omits unresolved vars from its map (so `show`
/// can render them as `<unset>`), which means the runtime-feeding paths
/// (`exec`, `source`) must gate on this themselves before launching a
/// workload or emitting exports — otherwise a missing required secret slips
/// through silently.
pub fn missing_required<'a>(
    schema: &'a ConfigFile,
    resolved: &HashMap<String, String>,
) -> Vec<&'a str> {
    schema
        .vars
        .iter()
        .filter(|v| v.required && !resolved.contains_key(&v.name))
        .map(|v| v.name.as_str())
        .collect()
}

/// `resolve_all` then fail closed if any `required` var is unresolved.
pub fn resolve_required(schema: &ConfigFile) -> Result<HashMap<String, String>> {
    let resolved = resolve_all(schema)?;
    let missing = missing_required(schema, &resolved);
    if !missing.is_empty() {
        bail!(
            "missing required config var(s): {}. \
             Set them in .env, the environment, or via an op:// ref \
             (OP_MODE=on with a service-account token).",
            missing.join(", ")
        );
    }
    Ok(resolved)
}

pub fn resolve_all(schema: &ConfigFile) -> Result<HashMap<String, String>> {
    resolve_all_with(schema, op::resolve)
}

/// `resolve_all` with the 1Password resolver injected, so the op branch is
/// deterministically testable without a live agent.
fn resolve_all_with(
    schema: &ConfigFile,
    op_resolve: impl Fn(&crate::schema::Var, &str) -> Result<Option<String>>,
) -> Result<HashMap<String, String>> {
    let _ = dotenvy::dotenv();

    let op_mode = std::env::var("OP_MODE").unwrap_or_else(|_| "auto".to_string());
    let use_op = match op_mode.as_str() {
        "off" => false,
        "on" => true,
        _ => op::is_available(),
    };

    let mut result = HashMap::new();
    for var in &schema.vars {
        // When op is engaged for a var with an op_ref, that ref is the source
        // of truth: op::resolve now errors loudly on a failed read rather than
        // returning None, so there is no silent fall-through to env here. Use
        // OP_MODE=off to resolve such a var from the environment instead.
        let value = if use_op && var.op_ref.is_some() {
            op_resolve(var, &schema.config.app_prefix)?
        } else {
            env::resolve(var)
        };
        if let Some(v) = value {
            result.insert(var.name.clone(), v);
        }
    }
    Ok(result)
}

#[cfg(test)]
#[allow(unsafe_code)]
mod tests {
    use super::*;
    use crate::schema::{ConfigFile, ConfigMeta, Var};

    fn var(name: &str, required: bool) -> Var {
        Var {
            name: name.into(),
            description: String::new(),
            required,
            default: None,
            op_ref: None,
            secret: false,
        }
    }

    fn op_var(name: &str, op_ref: &str) -> Var {
        Var {
            name: name.into(),
            description: String::new(),
            required: false,
            default: None,
            op_ref: Some(op_ref.into()),
            secret: true,
        }
    }

    #[test]
    fn resolve_all_uses_injected_op_resolver_for_op_ref_vars_when_enabled() {
        // SAFETY: test-only; OP_MODE=on forces the op branch deterministically.
        unsafe { std::env::set_var("OP_MODE", "on") };
        let s = schema(vec![op_var("TOKEN", "op://v/i/f")]);
        let out = resolve_all_with(&s, |_v, _p| Ok(Some("from-op".to_string()))).unwrap();
        // SAFETY: test-only cleanup.
        unsafe { std::env::remove_var("OP_MODE") };
        assert_eq!(out.get("TOKEN").map(String::as_str), Some("from-op"));
    }

    #[test]
    fn resolve_all_propagates_op_resolver_errors() {
        // SAFETY: test-only; OP_MODE=on forces the op branch deterministically.
        unsafe { std::env::set_var("OP_MODE", "on") };
        let s = schema(vec![op_var("TOKEN", "op://v/i/f")]);
        let result = resolve_all_with(&s, |_v, _p| anyhow::bail!("op blew up"));
        // SAFETY: test-only cleanup.
        unsafe { std::env::remove_var("OP_MODE") };
        assert!(result.is_err());
    }

    fn schema(vars: Vec<Var>) -> ConfigFile {
        ConfigFile {
            config: ConfigMeta {
                version: "1".into(),
                app_prefix: "APP".into(),
            },
            vars,
        }
    }

    #[test]
    fn missing_required_lists_unresolved_required_vars_in_order() {
        let s = schema(vec![var("A", true), var("B", false), var("C", true)]);
        let mut resolved = HashMap::new();
        resolved.insert("B".to_string(), "x".to_string());
        assert_eq!(missing_required(&s, &resolved), vec!["A", "C"]);
    }

    #[test]
    fn missing_required_empty_when_all_required_present() {
        let s = schema(vec![var("A", true), var("B", false)]);
        let mut resolved = HashMap::new();
        resolved.insert("A".to_string(), "x".to_string());
        assert!(missing_required(&s, &resolved).is_empty());
    }

    #[test]
    fn missing_required_ignores_optional_vars() {
        let s = schema(vec![var("OPT", false)]);
        let resolved = HashMap::new();
        assert!(missing_required(&s, &resolved).is_empty());
    }
}
