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
        assert!(is_available());
    }
}
