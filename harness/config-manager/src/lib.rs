//! `harness-config-manager` — config-manager slot.
//!
//! Typed env-var schema from `config.toml`, `.env.example` codegen, `.env` sync,
//! and optional 1Password secret resolution.

#![deny(unsafe_code)]
#![deny(clippy::all)]
#![warn(unused)]

pub mod check;
pub mod codegen;
pub mod env_file;
pub mod exec;
pub mod resolver;
pub mod schema;
pub mod shell;

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
            // Fail closed: `eval $(harness config source)` must not silently
            // export a partial environment when a required secret is missing.
            let env = resolver::resolve_required(&schema)?;
            // Single-quote every value so the evaluating shell performs NO
            // expansion on it — a secret containing $(...) or backticks is
            // emitted literally, not executed. See shell::single_quote.
            for (k, v) in &env {
                println!("export {k}={}", shell::single_quote(v));
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
                    println!(
                        "{} = {}",
                        var.name,
                        val.map(String::as_str).unwrap_or("<unset>")
                    );
                }
            }
            Ok(())
        }
    }
}
