use crate::schema::Var;
use anyhow::{Context, Result, bail};
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

    // Surface a spawn failure rather than silently falling through: if the
    // resolver decided to use `op` at all, the binary failing to run is a real
    // error the operator needs to see, not a reason to quietly use a default.
    let output = cmd.output().with_context(|| {
        format!("failed to run `op read` for {op_ref}; is the 1Password CLI installed and on PATH?")
    })?;

    interpret(
        op_ref,
        output.status.success(),
        output.stdout,
        &output.stderr,
    )
}

/// Turn an `op read` result into a resolved value or a loud error.
///
/// Split out from the `Command` plumbing so the success / failure / non-UTF-8
/// branches are unit-testable without a live 1Password agent. A non-zero exit
/// (bad token, missing item, no auth) becomes an `Err` carrying op's stderr —
/// never a silent `Ok(None)` that would let a missing secret slip through.
/// The value is returned verbatim: `--no-newline` already suppresses the
/// trailing newline, so we do NOT trim (trimming would corrupt secrets with
/// significant leading/trailing whitespace).
fn interpret(
    op_ref: &str,
    success: bool,
    stdout: Vec<u8>,
    stderr: &[u8],
) -> Result<Option<String>> {
    if success {
        let val = String::from_utf8(stdout)
            .with_context(|| format!("`op read` returned non-UTF-8 output for {op_ref}"))?;
        Ok(Some(val))
    } else {
        let msg = String::from_utf8_lossy(stderr);
        let msg = msg.trim();
        if msg.is_empty() {
            bail!("`op read` failed for {op_ref} (no stderr)");
        }
        bail!("`op read` failed for {op_ref}: {msg}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpret_returns_value_verbatim_on_success() {
        let out = interpret("op://v/i/f", true, b"s3cr3t".to_vec(), b"");
        assert_eq!(out.unwrap(), Some("s3cr3t".to_string()));
    }

    #[test]
    fn interpret_preserves_significant_whitespace() {
        // --no-newline means op gives us exactly the secret; do not trim it.
        let out = interpret("op://v/i/f", true, b"  pad \n".to_vec(), b"");
        assert_eq!(out.unwrap(), Some("  pad \n".to_string()));
    }

    #[test]
    fn interpret_errors_loudly_on_failure_with_stderr() {
        let err = interpret(
            "op://v/i/missing",
            false,
            Vec::new(),
            b"[ERROR] item not found",
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("op://v/i/missing"), "got: {err}");
        assert!(err.contains("item not found"), "got: {err}");
    }

    #[test]
    fn interpret_errors_on_failure_without_stderr() {
        let err = interpret("op://v/i/f", false, Vec::new(), b"  ")
            .unwrap_err()
            .to_string();
        assert!(err.contains("no stderr"), "got: {err}");
    }

    #[test]
    fn interpret_errors_on_non_utf8_output() {
        let err = interpret("op://v/i/f", true, vec![0xff, 0xfe], b"")
            .unwrap_err()
            .to_string();
        assert!(err.contains("non-UTF-8"), "got: {err}");
    }

    #[test]
    fn resolve_returns_none_when_var_has_no_op_ref() {
        let var = Var {
            name: "X".into(),
            description: String::new(),
            required: false,
            default: None,
            op_ref: None,
            secret: false,
        };
        assert_eq!(resolve(&var, "APP").unwrap(), None);
    }
}

#[cfg(test)]
#[cfg(feature = "op-integration")]
mod integration_tests {
    use super::*;

    #[test]
    fn is_available_returns_true_when_op_installed() {
        assert!(is_available());
    }
}
