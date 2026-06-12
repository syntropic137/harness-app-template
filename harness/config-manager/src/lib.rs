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
            // {v:?} (Debug) escapes inner quotes and control chars but does NOT
            // prevent subshell expansion ($(...) or backticks) in the shell that
            // evals this output. Trust your .env the same way you trust a shell script.
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
