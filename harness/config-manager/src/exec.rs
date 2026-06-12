use crate::resolver;
use crate::schema::ConfigFile;
use anyhow::{Result, bail};
use std::process::Command;

pub fn run(schema: &ConfigFile, cmd: &[String]) -> Result<()> {
    if cmd.is_empty() {
        bail!("exec requires a command: harness config exec -- <cmd> [args...]");
    }

    let env = resolver::resolve_all(schema)?;

    let status = Command::new(&cmd[0]).args(&cmd[1..]).envs(&env).status()?;

    std::process::exit(status.code().unwrap_or(1));
}
