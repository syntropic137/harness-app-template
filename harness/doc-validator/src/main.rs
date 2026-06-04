//! harness-doc-validator CLI entrypoint.

#![forbid(unsafe_code)]

use harness_doc_validator::parse_cli;
use std::process::ExitCode;

fn main() -> ExitCode {
    let cli = parse_cli();
    match harness_doc_validator::run(cli) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::from(2)
        }
    }
}
