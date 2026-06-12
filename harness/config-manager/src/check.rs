use crate::schema::ConfigFile;
use anyhow::{Result, bail};

pub fn run(schema: &ConfigFile) -> Result<()> {
    let _ = dotenvy::dotenv();

    let missing: Vec<&str> = schema
        .vars
        .iter()
        .filter(|v| v.required && v.default.is_none())
        .filter(|v| std::env::var(&v.name).is_err())
        .map(|v| v.name.as_str())
        .collect();

    if missing.is_empty() {
        return Ok(());
    }

    let list = missing
        .iter()
        .map(|n| format!("  {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    bail!("Missing required environment variables:\n{list}");
}
