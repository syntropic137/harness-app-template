//! harness-versioning CLI entrypoint — thin shell over `lib::run`.

#![forbid(unsafe_code)]

use clap::Parser;
use harness_versioning::Cli;
use std::process::ExitCode;

fn main() -> ExitCode {
    let cli = Cli::parse();
    match harness_versioning::run(cli) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::from(2)
        }
    }
}
