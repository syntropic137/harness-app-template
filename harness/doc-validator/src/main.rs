//! harness-doc-validator CLI entrypoint.

#![forbid(unsafe_code)]

use clap::Parser;
use harness_doc_validator::{Cli, default_excludes};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser, Debug, Clone)]
#[command(
    name = "harness-doc-validator",
    version,
    about = "Check Markdown links, APSS ADR shape, and harness manifest cross-references."
)]
struct Args {
    /// Repository root to validate.
    #[arg(default_value = ".")]
    root: PathBuf,

    /// Substring exclude patterns matched against full paths.
    #[arg(long, default_values_t = default_excludes())]
    exclude: Vec<String>,

    /// JSON output instead of human-readable output.
    #[arg(long)]
    json: bool,
}

impl From<Args> for Cli {
    fn from(args: Args) -> Self {
        Self {
            root: args.root,
            exclude: args.exclude,
            json: args.json,
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::from(Args::parse());
    match harness_doc_validator::run(cli) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::from(2)
        }
    }
}
