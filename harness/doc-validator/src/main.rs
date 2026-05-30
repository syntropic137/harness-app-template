//! harness-doc-validator CLI entrypoint.

#![forbid(unsafe_code)]

use clap::Parser;
use harness_doc_validator::Cli;
use std::process::ExitCode;

fn main() -> ExitCode {
    let cli = Cli::parse();
    match harness_doc_validator::run(cli) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::from(2)
        }
    }
}
