use anyhow::Result;
use clap::Parser;
use harness_config_manager::{Cli, run};

fn main() -> Result<()> {
    let cli = Cli::parse();
    run(cli.command)
}
