# Config-Manager Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `config-manager` harness slot — a Rust binary that provides typed env-var schema validation, `.env.example` codegen, `.env` sync, and opt-in 1Password secret resolution.

**Architecture:** A self-contained Rust crate at `harness/config-manager/` (not in the root workspace, following slot conventions). `config.toml` at the repo root is the single source of truth. The binary exposes five subcommands (`check`, `sync`, `exec`, `source`, `show`) wired into `just config` recipes.

**Tech Stack:** Rust 2024 edition, `clap` (derive), `serde` + `toml`, `dotenvy`, `which`, `anyhow`, `tempfile` (dev)

---

## File Map

| File | Responsibility |
|---|---|
| `harness/config-manager/Cargo.toml` | Self-contained crate manifest with `[workspace]` block |
| `harness/config-manager/src/main.rs` | CLI entry — parses args, delegates to `lib::run()` |
| `harness/config-manager/src/lib.rs` | `Cli` + `Commands` enums, `run()` dispatcher |
| `harness/config-manager/src/schema.rs` | `ConfigFile`, `ConfigMeta`, `Var` structs + `load()` |
| `harness/config-manager/src/check.rs` | Aggregated missing-var validation |
| `harness/config-manager/src/codegen.rs` | `.env.example` content generation |
| `harness/config-manager/src/env_file.rs` | `.env` parse, sync, archive logic |
| `harness/config-manager/src/resolver/mod.rs` | `resolve_all()` dispatcher — OP → env fallback |
| `harness/config-manager/src/resolver/env.rs` | Ambient env + default fallback |
| `harness/config-manager/src/resolver/op.rs` | 1Password subprocess resolver |
| `harness/config-manager/src/exec.rs` | Subprocess wrapper for `config exec` |
| `harness/config-manager/tests/integration_test.rs` | Binary invocation integration tests |
| `harness/config-manager/bin/config-manager` | Shell wrapper (build + exec) |
| `justfile` | Add `config *args` recipe + `just config check` in bootstrap |
| `config.toml` | Repo-root schema file (example committed) |
| `docs/adrs/ADR-NNNN-config-manager.md` | Slot ADR (number assigned at execution time; 0012 is taken by binary-distribution) |

---

### Task 1: Scaffold the crate

**Files:**
- Create: `harness/config-manager/Cargo.toml`
- Create: `harness/config-manager/src/main.rs`
- Create: `harness/config-manager/src/lib.rs`
- Create: `harness/config-manager/bin/config-manager`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p harness/config-manager/src/resolver
mkdir -p harness/config-manager/bin
mkdir -p harness/config-manager/tests
```

- [ ] **Step 2: Write `Cargo.toml`**

```toml
[package]
name = "harness-config-manager"
version = "0.1.0"
edition = "2024"
description = "Harness config-manager slot: typed env-var schema, codegen, secret resolution"

[[bin]]
name = "harness-config-manager"
path = "src/main.rs"

[lib]
name = "harness_config_manager"
path = "src/lib.rs"

[dependencies]
anyhow = "1"
clap = { version = "4", features = ["derive"] }
dotenvy = "0.15"
serde = { version = "1", features = ["derive"] }
toml = "0.8"
which = "7"

[dev-dependencies]
tempfile = "3"

[workspace]

[package.metadata.coverage]
exclude = ["src/main.rs"]
```

- [ ] **Step 3: Write `src/main.rs`**

```rust
use anyhow::Result;
use harness_config_manager::{Cli, run};
use clap::Parser;

fn main() -> Result<()> {
    let cli = Cli::parse();
    run(cli.command)
}
```

- [ ] **Step 4: Write `src/lib.rs` skeleton**

```rust
#![deny(unsafe_code)]
#![deny(clippy::all)]
#![warn(unused)]

pub mod check;
pub mod codegen;
pub mod env_file;
pub mod exec;
pub mod resolver;
pub mod schema;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "config-manager", about = "Harness config-manager slot")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Validate all required vars are present; reports all missing at once
    Check,
    /// Regenerate .env.example and sync .env (preserves values, archives removed vars)
    Sync,
    /// Resolve secrets and run a subprocess with injected env
    Exec {
        #[arg(last = true)]
        cmd: Vec<String>,
    },
    /// Emit shell exports to stdout: eval $(harness config source)
    Source,
    /// Pretty-print resolved config, masking secret values
    Show,
}

pub fn run(command: Commands) -> Result<()> {
    match command {
        Commands::Check => {
            let schema = schema::load("config.toml")?;
            check::run(&schema)
        }
        Commands::Sync => {
            let schema = schema::load("config.toml")?;
            codegen::write_example(&schema, ".env.example")?;
            env_file::sync(&schema, ".env.example", ".env")
        }
        Commands::Exec { cmd } => {
            let schema = schema::load("config.toml")?;
            exec::run(&schema, &cmd)
        }
        Commands::Source => {
            let schema = schema::load("config.toml")?;
            let env = resolver::resolve_all(&schema)?;
            for (k, v) in &env {
                println!("export {k}={v:?}");
            }
            Ok(())
        }
        Commands::Show => {
            let schema = schema::load("config.toml")?;
            let env = resolver::resolve_all(&schema)?;
            for var in &schema.vars {
                let val = env.get(&var.name);
                if var.secret || var.op_ref.is_some() {
                    println!("{} = {}", var.name, val.map(|_| "***").unwrap_or("<unset>"));
                } else {
                    println!("{} = {}", var.name, val.map(String::as_str).unwrap_or("<unset>"));
                }
            }
            Ok(())
        }
    }
}
```

- [ ] **Step 5: Create stub modules so the crate compiles**

Create `harness/config-manager/src/check.rs`:
```rust
use crate::schema::ConfigFile;
use anyhow::Result;
pub fn run(_schema: &ConfigFile) -> Result<()> { todo!() }
```

Create `harness/config-manager/src/codegen.rs`:
```rust
use crate::schema::ConfigFile;
use anyhow::Result;
pub fn write_example(_schema: &ConfigFile, _path: &str) -> Result<()> { todo!() }
```

Create `harness/config-manager/src/env_file.rs`:
```rust
use crate::schema::ConfigFile;
use anyhow::Result;
use std::collections::HashMap;
pub fn parse(_path: &str) -> HashMap<String, String> { HashMap::new() }
pub fn sync(_schema: &ConfigFile, _example: &str, _env: &str) -> Result<()> { todo!() }
```

Create `harness/config-manager/src/exec.rs`:
```rust
use crate::schema::ConfigFile;
use anyhow::Result;
pub fn run(_schema: &ConfigFile, _cmd: &[String]) -> Result<()> { todo!() }
```

Create `harness/config-manager/src/resolver/mod.rs`:
```rust
pub mod env;
pub mod op;
use crate::schema::ConfigFile;
use anyhow::Result;
use std::collections::HashMap;
pub fn resolve_all(_schema: &ConfigFile) -> Result<HashMap<String, String>> { todo!() }
```

Create `harness/config-manager/src/resolver/env.rs`:
```rust
use crate::schema::Var;
pub fn resolve(_var: &Var) -> Option<String> { None }
```

Create `harness/config-manager/src/resolver/op.rs`:
```rust
use crate::schema::Var;
use anyhow::Result;
pub fn is_available() -> bool { false }
pub fn resolve(_var: &Var, _app_prefix: &str) -> Result<Option<String>> { Ok(None) }
```

Create `harness/config-manager/src/schema.rs`:
```rust
use anyhow::Result;
use serde::Deserialize;
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
#[derive(Debug, Deserialize)]
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
pub fn load(_path: &str) -> Result<ConfigFile> { todo!() }
```

- [ ] **Step 6: Write the `bin/config-manager` wrapper**

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
cargo build --release -q
exec ./target/release/harness-config-manager "$@"
```

Then make it executable:
```bash
chmod +x harness/config-manager/bin/config-manager
```

- [ ] **Step 7: Verify the crate compiles**

```bash
cargo build --manifest-path harness/config-manager/Cargo.toml
```
Expected: compiles with warnings about `todo!()` arms, no errors.

- [ ] **Step 8: Commit scaffold**

```bash
git add harness/config-manager/
git commit -m "feat(config-manager): scaffold harness slot crate"
```

---

### Task 2: Schema parsing

**Files:**
- Modify: `harness/config-manager/src/schema.rs`
- Test: `harness/config-manager/tests/integration_test.rs` (schema section)

- [ ] **Step 1: Write the failing test**

Create `harness/config-manager/tests/integration_test.rs`:
```rust
use std::process::Command;
use tempfile::TempDir;

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_harness-config-manager")
}

fn write_config(dir: &TempDir, content: &str) {
    std::fs::write(dir.path().join("config.toml"), content).unwrap();
}

#[test]
fn schema_load_fails_on_missing_file() {
    let dir = TempDir::new().unwrap();
    let out = Command::new(binary())
        .arg("check")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("config.toml") || stderr.contains("No such file"));
}

#[test]
fn schema_load_fails_on_invalid_toml() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, "not valid toml ::::");
    let out = Command::new(binary())
        .arg("check")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml
```
Expected: FAIL — `schema_load_fails_on_missing_file` panics on `todo!()`.

- [ ] **Step 3: Implement `schema::load()`**

Replace `harness/config-manager/src/schema.rs` fully:
```rust
use anyhow::{Context, Result};
use serde::Deserialize;
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
    let content = fs::read_to_string(path)
        .with_context(|| format!("Failed to read {path}"))?;
    toml::from_str(&content)
        .with_context(|| format!("Failed to parse {path}"))
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml schema
```
Expected: both schema tests PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/config-manager/src/schema.rs harness/config-manager/tests/
git commit -m "feat(config-manager): implement schema parsing"
```

---

### Task 3: check subcommand

**Files:**
- Modify: `harness/config-manager/src/check.rs`
- Modify: `harness/config-manager/tests/integration_test.rs`

- [ ] **Step 1: Write failing tests** — append to `tests/integration_test.rs`:

```rust
const MINIMAL_CONFIG: &str = r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "REQUIRED_VAR"
description = "A required variable"
required = true

[[var]]
name = "OPTIONAL_VAR"
description = "An optional variable"
required = false
default = "default-value"
"#;

#[test]
fn check_fails_when_required_var_missing() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .arg("check")
        .current_dir(dir.path())
        .env_remove("REQUIRED_VAR")
        .output()
        .unwrap();
    assert!(!out.status.success(), "expected non-zero exit");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("REQUIRED_VAR"), "stderr: {stderr}");
}

#[test]
fn check_passes_when_required_var_in_env() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .arg("check")
        .env("REQUIRED_VAR", "somevalue")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn check_passes_when_required_var_in_dotenv() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=from-dotenv\n").unwrap();
    let out = Command::new(binary())
        .arg("check")
        .env_remove("REQUIRED_VAR")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn check_reports_all_missing_vars_at_once() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "FIRST_REQUIRED"
description = "First"
required = true

[[var]]
name = "SECOND_REQUIRED"
description = "Second"
required = true
"#);
    let out = Command::new(binary())
        .arg("check")
        .env_remove("FIRST_REQUIRED")
        .env_remove("SECOND_REQUIRED")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("FIRST_REQUIRED"), "stderr: {stderr}");
    assert!(stderr.contains("SECOND_REQUIRED"), "stderr: {stderr}");
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml check
```
Expected: FAIL — `todo!()` panics.

- [ ] **Step 3: Implement `check::run()`**

Replace `harness/config-manager/src/check.rs`:
```rust
use crate::schema::ConfigFile;
use anyhow::{bail, Result};

pub fn run(schema: &ConfigFile) -> Result<()> {
    // Load .env into process env if present (best-effort)
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
```

- [ ] **Step 4: Run tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml check
```
Expected: all 4 check tests PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/config-manager/src/check.rs harness/config-manager/tests/
git commit -m "feat(config-manager): implement check subcommand"
```

---

### Task 4: `.env.example` codegen

**Files:**
- Modify: `harness/config-manager/src/codegen.rs`
- Test: unit tests inside `src/codegen.rs`

- [ ] **Step 1: Write failing unit tests** — replace `src/codegen.rs`:

```rust
use crate::schema::ConfigFile;
use anyhow::Result;
use std::fs;

pub fn generate(schema: &ConfigFile) -> String {
    todo!()
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

    fn make_var(name: &str, desc: &str, required: bool, default: Option<&str>, op_ref: Option<&str>) -> Var {
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
        let schema = make_schema(vec![make_var("LOG_LEVEL", "Log level", false, Some("info"), None)]);
        let out = generate(&schema);
        assert!(!out.contains("[REQUIRED]"), "output:\n{out}");
        assert!(out.contains("LOG_LEVEL=info"), "output:\n{out}");
    }

    #[test]
    fn required_var_with_op_ref_includes_op_ref_in_marker() {
        let schema = make_schema(vec![
            make_var("API_KEY", "API key", true, None, Some("op://vault/item/field"))
        ]);
        let out = generate(&schema);
        assert!(out.contains("# [REQUIRED] | 1Password: op://vault/item/field"), "output:\n{out}");
    }

    #[test]
    fn vars_are_separated_by_blank_lines() {
        let schema = make_schema(vec![
            make_var("A", "First", false, Some("1"), None),
            make_var("B", "Second", false, Some("2"), None),
        ]);
        let out = generate(&schema);
        // There should be a blank line between the two vars
        assert!(out.contains("\n\n"), "output:\n{out}");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml codegen
```
Expected: FAIL — `todo!()`.

- [ ] **Step 3: Implement `generate()`**

Replace the `generate` function body in `src/codegen.rs`:
```rust
pub fn generate(schema: &ConfigFile) -> String {
    let mut lines: Vec<String> = Vec::new();
    for var in &schema.vars {
        lines.push(format!("# {}", var.description));
        if var.required {
            if let Some(op_ref) = &var.op_ref {
                lines.push(format!("# [REQUIRED] | 1Password: {op_ref}"));
            } else {
                lines.push("# [REQUIRED]".to_string());
            }
        } else if let Some(op_ref) = &var.op_ref {
            lines.push(format!("# 1Password: {op_ref}"));
        }
        let default = var.default.as_deref().unwrap_or("");
        lines.push(format!("{}={}", var.name, default));
        lines.push(String::new());
    }
    lines.join("\n")
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml codegen
```
Expected: all 4 codegen tests PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/config-manager/src/codegen.rs
git commit -m "feat(config-manager): implement .env.example codegen"
```

---

### Task 5: `.env` file parse and sync

**Files:**
- Modify: `harness/config-manager/src/env_file.rs`
- Modify: `harness/config-manager/tests/integration_test.rs`

- [ ] **Step 1: Write failing unit tests** — replace `src/env_file.rs`:

```rust
use crate::schema::ConfigFile;
use anyhow::Result;
use std::collections::{HashMap, HashSet};
use std::fs;

pub fn parse(path: &str) -> HashMap<String, String> {
    todo!()
}

pub fn sync(schema: &ConfigFile, example_path: &str, env_path: &str) -> Result<()> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(dir: &TempDir, name: &str, content: &str) -> String {
        let path = dir.path().join(name);
        fs::write(&path, content).unwrap();
        path.to_str().unwrap().to_string()
    }

    #[test]
    fn parse_reads_key_value_pairs() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, ".env", "FOO=bar\nBAZ=qux\n");
        let map = parse(&path);
        assert_eq!(map.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(map.get("BAZ").map(String::as_str), Some("qux"));
    }

    #[test]
    fn parse_skips_comments_and_blank_lines() {
        let dir = TempDir::new().unwrap();
        let path = write(&dir, ".env", "# comment\n\nFOO=bar\n");
        let map = parse(&path);
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("FOO").map(String::as_str), Some("bar"));
    }

    #[test]
    fn parse_returns_empty_map_for_missing_file() {
        let map = parse("/nonexistent/.env");
        assert!(map.is_empty());
    }
}
```

- [ ] **Step 2: Run to verify failures**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml env_file
```
Expected: FAIL — `todo!()`.

- [ ] **Step 3: Implement `parse()`**

Replace the `parse` function body:
```rust
pub fn parse(path: &str) -> HashMap<String, String> {
    let Ok(content) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    content
        .lines()
        .filter(|l| !l.trim().starts_with('#') && !l.trim().is_empty())
        .filter_map(|l| {
            let (k, v) = l.split_once('=')?;
            Some((k.trim().to_string(), v.trim().to_string()))
        })
        .collect()
}
```

- [ ] **Step 4: Run parse tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml env_file::tests::parse
```
Expected: all 3 parse tests PASS.

- [ ] **Step 5: Write failing sync integration tests** — append to `tests/integration_test.rs`:

```rust
#[test]
fn sync_generates_env_example() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .args(["sync"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let example = std::fs::read_to_string(dir.path().join(".env.example")).unwrap();
    assert!(example.contains("REQUIRED_VAR="), "example:\n{example}");
    assert!(example.contains("[REQUIRED]"), "example:\n{example}");
    assert!(example.contains("OPTIONAL_VAR=default-value"), "example:\n{example}");
}

#[test]
fn sync_preserves_existing_env_values() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=my-secret\n").unwrap();
    let out = Command::new(binary())
        .args(["sync"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let env = std::fs::read_to_string(dir.path().join(".env")).unwrap();
    assert!(env.contains("REQUIRED_VAR=my-secret"), "env:\n{env}");
}

#[test]
fn sync_archives_removed_vars() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    // .env has a var not in config.toml
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=val\nOLD_VAR=legacy\n").unwrap();
    let out = Command::new(binary())
        .args(["sync"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let env = std::fs::read_to_string(dir.path().join(".env")).unwrap();
    assert!(env.contains("ARCHIVED VARIABLES"), "env:\n{env}");
    assert!(env.contains("OLD_VAR=legacy"), "env:\n{env}");
}
```

- [ ] **Step 6: Run sync tests to verify they fail**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml sync
```
Expected: FAIL — `todo!()` in `sync`.

- [ ] **Step 7: Implement `sync()`**

Replace the `sync` function body:
```rust
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
```

- [ ] **Step 8: Run all tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml
```
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add harness/config-manager/src/env_file.rs harness/config-manager/tests/
git commit -m "feat(config-manager): implement .env parse and sync"
```

---

### Task 6: Resolver — env fallback + dispatch

**Files:**
- Modify: `harness/config-manager/src/resolver/env.rs`
- Modify: `harness/config-manager/src/resolver/mod.rs`

- [ ] **Step 1: Write unit tests** — add to `src/resolver/env.rs`:

```rust
use crate::schema::Var;
use std::env;

pub fn resolve(var: &Var) -> Option<String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{ConfigMeta, Var};

    fn var(name: &str, default: Option<&str>) -> Var {
        Var {
            name: name.into(),
            description: String::new(),
            required: false,
            default: default.map(str::to_owned),
            op_ref: None,
            secret: false,
        }
    }

    #[test]
    fn resolves_from_environment() {
        env::set_var("TEST_RESOLVE_ENV_VAR", "from-env");
        let v = var("TEST_RESOLVE_ENV_VAR", None);
        assert_eq!(resolve(&v), Some("from-env".to_string()));
        env::remove_var("TEST_RESOLVE_ENV_VAR");
    }

    #[test]
    fn falls_back_to_default() {
        env::remove_var("TEST_RESOLVE_MISSING");
        let v = var("TEST_RESOLVE_MISSING", Some("default-val"));
        assert_eq!(resolve(&v), Some("default-val".to_string()));
    }

    #[test]
    fn returns_none_when_missing_and_no_default() {
        env::remove_var("TEST_RESOLVE_NONE");
        let v = var("TEST_RESOLVE_NONE", None);
        assert_eq!(resolve(&v), None);
    }
}
```

- [ ] **Step 2: Run to verify failures**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml resolver::env
```
Expected: FAIL — `todo!()`.

- [ ] **Step 3: Implement `resolver::env::resolve()`**

Replace the `resolve` body:
```rust
pub fn resolve(var: &Var) -> Option<String> {
    env::var(&var.name).ok().or_else(|| var.default.clone())
}
```

- [ ] **Step 4: Implement `resolver::resolve_all()`** — replace `src/resolver/mod.rs`:

```rust
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
```

- [ ] **Step 5: Run all tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add harness/config-manager/src/resolver/
git commit -m "feat(config-manager): implement resolver dispatch and env fallback"
```

---

### Task 7: 1Password resolver

**Files:**
- Modify: `harness/config-manager/src/resolver/op.rs`

- [ ] **Step 1: Write the implementation** — replace `src/resolver/op.rs`:

```rust
use crate::schema::Var;
use anyhow::Result;
use std::env;
use std::process::Command;

pub fn is_available() -> bool {
    which::which("op").is_ok()
}

pub fn resolve(var: &Var, app_prefix: &str) -> Result<Option<String>> {
    let op_ref = match &var.op_ref {
        Some(r) => r,
        None => return Ok(None),
    };

    let token_key = format!("{app_prefix}_OP_SERVICE_ACCOUNT_TOKEN");
    let mut cmd = Command::new("op");
    cmd.args(["read", "--no-newline", op_ref]);

    if let Ok(token) = env::var(&token_key) {
        cmd.env("OP_SERVICE_ACCOUNT_TOKEN", token);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => return Ok(None),
    };

    if output.status.success() {
        let val = String::from_utf8(output.stdout)?.trim().to_string();
        Ok(Some(val))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
#[cfg(feature = "op-integration")]
mod tests {
    use super::*;

    #[test]
    fn is_available_returns_true_when_op_installed() {
        // Only runs when op binary is present and feature flag is set
        assert!(is_available());
    }
}
```

- [ ] **Step 2: Add the feature flag to `Cargo.toml`** — add under `[package]`:

```toml
[features]
op-integration = []
```

- [ ] **Step 3: Verify it compiles**

```bash
cargo build --manifest-path harness/config-manager/Cargo.toml
```
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add harness/config-manager/src/resolver/op.rs harness/config-manager/Cargo.toml
git commit -m "feat(config-manager): implement 1Password resolver with service account support"
```

---

### Task 8: exec subcommand

**Files:**
- Modify: `harness/config-manager/src/exec.rs`
- Modify: `harness/config-manager/tests/integration_test.rs`

- [ ] **Step 1: Write failing integration test** — append to `tests/integration_test.rs`:

```rust
#[test]
fn exec_injects_env_into_subprocess() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=injected\n").unwrap();

    // Use `env` to print environment variables
    let out = Command::new(binary())
        .args(["exec", "--", "env"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("REQUIRED_VAR=injected"), "stdout:\n{stdout}");
}

#[test]
fn exec_fails_when_no_command_given() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    let out = Command::new(binary())
        .args(["exec", "--"])
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(!out.status.success());
}
```

- [ ] **Step 2: Run to verify failures**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml exec
```
Expected: FAIL — `todo!()`.

- [ ] **Step 3: Implement `exec::run()`** — replace `src/exec.rs`:

```rust
use crate::resolver;
use crate::schema::ConfigFile;
use anyhow::{bail, Result};
use std::process::Command;

pub fn run(schema: &ConfigFile, cmd: &[String]) -> Result<()> {
    if cmd.is_empty() {
        bail!("exec requires a command: harness config exec -- <cmd> [args...]");
    }

    let env = resolver::resolve_all(schema)?;

    let status = Command::new(&cmd[0])
        .args(&cmd[1..])
        .envs(&env)
        .status()?;

    std::process::exit(status.code().unwrap_or(1));
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml exec
```
Expected: both exec tests PASS.

- [ ] **Step 5: Commit**

```bash
git add harness/config-manager/src/exec.rs harness/config-manager/tests/
git commit -m "feat(config-manager): implement exec subcommand"
```

---

### Task 9: source and show subcommands

**Files:**
- Modify: `harness/config-manager/tests/integration_test.rs`

These subcommands are already wired in `lib.rs`. This task adds integration tests to verify them.

- [ ] **Step 1: Write integration tests** — append to `tests/integration_test.rs`:

```rust
#[test]
fn source_emits_shell_exports() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, MINIMAL_CONFIG);
    std::fs::write(dir.path().join(".env"), "REQUIRED_VAR=sourced\n").unwrap();
    let out = Command::new(binary())
        .arg("source")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("export REQUIRED_VAR="), "stdout:\n{stdout}");
}

#[test]
fn show_masks_secret_values() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "MY_SECRET"
description = "A secret"
required = false
default = "plaintext"
secret = true
"#);
    let out = Command::new(binary())
        .arg("show")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("MY_SECRET = ***"), "stdout:\n{stdout}");
    assert!(!stdout.contains("plaintext"), "should not show plaintext: {stdout}");
}

#[test]
fn show_displays_non_secret_values() {
    let dir = TempDir::new().unwrap();
    write_config(&dir, r#"
[config]
version = "1"
app_prefix = "TEST"

[[var]]
name = "LOG_LEVEL"
description = "Log level"
required = false
default = "info"
"#);
    let out = Command::new(binary())
        .arg("show")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "stderr: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("LOG_LEVEL = info"), "stdout:\n{stdout}");
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml source
cargo test --manifest-path harness/config-manager/Cargo.toml show
```
Expected: all PASS (subcommands already implemented in lib.rs).

- [ ] **Step 3: Commit**

```bash
git add harness/config-manager/tests/
git commit -m "test(config-manager): integration tests for source and show subcommands"
```

---

### Task 10: justfile integration and bootstrap wiring

**Files:**
- Modify: `justfile`
- Create: `config.toml` (example schema at repo root)

- [ ] **Step 1: Write failing test** — verify `just config check` works end-to-end. This is a manual smoke-test step, not automated:

```bash
# From repo root — should fail because config.toml doesn't exist yet
just config check 2>&1 | grep -q "config.toml" && echo "PASS: error mentions config.toml"
```
Expected: outputs error mentioning `config.toml`.

- [ ] **Step 2: Add `just` recipes** — open `justfile` and add after the existing slot recipes:

```just
# config-manager slot: typed env-var schema, codegen, secret resolution
config *args:
    harness/config-manager/bin/config-manager {{args}}

# Build the config-manager binary (called automatically by the wrapper)
build-config-manager:
    cargo build --release --manifest-path harness/config-manager/Cargo.toml
```

Then find the `bootstrap` recipe and add `just config check` to it. Look for a line that calls slot checks and add:
```just
just config check
```

- [ ] **Step 3: Create the example `config.toml`**

```toml
[config]
version = "1"
app_prefix = "MYAPP"    # Change to your project name — sets MYAPP_OP_SERVICE_ACCOUNT_TOKEN

# Add your environment variables below as [[var]] entries.
# Run `just config sync` after any change to regenerate .env.example and sync .env.

[[var]]
name = "EXAMPLE_VAR"
description = "Replace this with your first real variable"
required = false
default = "example-default"
```

- [ ] **Step 4: Run `just config sync` to generate `.env.example`**

```bash
just config sync
```
Expected: creates `.env.example` with the EXAMPLE_VAR entry.

- [ ] **Step 5: Add `.env` and `.env.runtime` to `.gitignore`** — append if not present:

```
.env
.env.runtime
```

- [ ] **Step 6: Run `just config check`**

```bash
just config check
```
Expected: exits 0 (EXAMPLE_VAR is optional with a default).

- [ ] **Step 7: Commit**

```bash
git add justfile config.toml .env.example .gitignore
git commit -m "feat(config-manager): wire slot into justfile and add example config.toml"
```

---

### Task 11: Coverage gate

**Files:**
- Modify: `justfile`

- [ ] **Step 1: Add coverage recipe** — add to `justfile`:

```just
# Coverage gate for config-manager slot (100% lib, main.rs excluded)
cov-config-manager:
    cargo build --manifest-path harness/config-manager/Cargo.toml --bin harness-config-manager
    cargo llvm-cov --manifest-path harness/config-manager/Cargo.toml \
        --package harness-config-manager \
        --lib \
        --ignore-filename-regex 'main\.rs' \
        --fail-under-lines 80 \
        --fail-under-functions 80
```

> Note: gate starts at 80% (not 100%) because the OP resolver has integration-only paths. Raise to 100% once the OP integration tests run in CI.

- [ ] **Step 2: Run the coverage gate**

```bash
just cov-config-manager
```
Expected: passes. If `cargo-llvm-cov` is not installed: `cargo install cargo-llvm-cov`.

- [ ] **Step 3: Run the full test suite one final time**

```bash
cargo test --manifest-path harness/config-manager/Cargo.toml
```
Expected: all tests PASS, no warnings about unused code.

- [ ] **Step 4: Commit**

```bash
git add justfile
git commit -m "test(config-manager): add coverage gate to justfile"
```

---

### Task 12: ADR

The ADR number is assigned at execution time from the next free slot in
`docs/adrs/` (0012 is taken by binary-distribution); `NNNN` below is a
placeholder, not a reference to an existing file.

**Files:**
- Create: `docs/adrs/ADR-NNNN-config-manager.md`

- [ ] **Step 1: Write the ADR** using the existing ADR format from `docs/adrs/`. Create `docs/adrs/ADR-NNNN-config-manager.md`:

```markdown
# ADR-NNNN: config-manager slot

**Status:** accepted
**Date:** 2026-06-11

## Context

The harness had no slot for centralized env-var management or runtime secret provisioning. Individual slots declared their own env vars ad hoc with no schema, no fast-fail validation, and no `.env.example` codegen.

## Decision

Add a `config-manager` slot implemented as a Rust binary. Single source of truth is `config.toml` at the repo root. The binary provides five subcommands: `check`, `sync`, `exec`, `source`, `show`.

1Password secret resolution is opt-in per-var via `op_ref` field. The token is project-namespaced (`<APP_PREFIX>_OP_SERVICE_ACCOUNT_TOKEN`) to prevent collision across projects on shared machines.

## Alternatives considered

- **Per-language libraries** (pydantic-settings in Python, figment in Rust): couples config schema to each workspace's language. Rejected — polyglot repos need one schema, not N.
- **Two separate slots** (config schema + secret resolver): adds slot count complexity without benefit. The 1Password layer is already opt-in and removable per-var.

## Reference implementations

- Syntropic137: `packages/syn-shared/src/syn_shared/settings/` — Pydantic BaseSettings pattern with `.env.example` codegen and idempotent sync.
- OpenClaw Hermes: `scripts/config/env.ts` — central registry with 1Password priority chain and `op run` subprocess injection.

## Consequences

- `just bootstrap` now calls `just config check` — missing required vars surface at clone time.
- Developers maintain `config.toml`; `.env.example` is generated, never hand-edited.
- Removing 1Password support: delete `op_ref` fields from `config.toml` and `harness/config-manager/src/resolver/op.rs`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adrs/ADR-NNNN-config-manager.md
git commit -m "docs(adr): ADR-NNNN config-manager slot"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Slot identity and `config.toml` schema → Task 1-2
- ✅ `check` subcommand with aggregated errors → Task 3
- ✅ `.env.example` codegen with descriptions, [REQUIRED], op_ref → Task 4
- ✅ `.env` sync (preserve values, archive removed) → Task 5
- ✅ Resolver dispatch with env fallback → Task 6
- ✅ 1Password resolver with prefixed token + three auth modes → Task 7
- ✅ `exec` subprocess wrapper → Task 8
- ✅ `source` shell export + `show` with secret masking → Task 9
- ✅ justfile wiring + bootstrap integration + `config.toml` example → Task 10
- ✅ Coverage gate → Task 11
- ✅ ADR → Task 12

**Placeholder scan:** No TBDs, no "similar to Task N" references, all code blocks complete.

**Type consistency:** `ConfigFile.vars: Vec<Var>` used consistently across all modules. `schema::load()` signature `(path: &str) -> Result<ConfigFile>` matches all call sites in `lib.rs`.
