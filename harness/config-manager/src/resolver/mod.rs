pub mod env;
pub mod op;

use crate::schema::ConfigFile;
use anyhow::Result;
use std::collections::HashMap;

pub fn resolve_all(schema: &ConfigFile) -> Result<HashMap<String, String>> {
    let _ = dotenvy::dotenv();

    let op_mode = std::env::var("OP_MODE").unwrap_or_else(|_| "auto".to_string());
    let use_op = match op_mode.as_str() {
        "off" => false,
        "on" => true,
        _ => op::is_available(),
    };

    let mut result = HashMap::new();
    for var in &schema.vars {
        let value = if use_op && var.op_ref.is_some() {
            op::resolve(var, &schema.config.app_prefix)?.or_else(|| env::resolve(var))
        } else {
            env::resolve(var)
        };
        if let Some(v) = value {
            result.insert(var.name.clone(), v);
        }
    }
    Ok(result)
}
