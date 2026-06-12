use crate::schema::ConfigFile;
use anyhow::{Result, bail};

// Intentionally offline: `check` reads .env and ambient env only — it does not
// resolve op:// refs. A required var with op_ref will fail check if not also
// set in .env or the process environment. Use `exec`/`source` to inject OP secrets.
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
