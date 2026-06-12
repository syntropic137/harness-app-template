//! POSIX shell-safe quoting for `source` output.
//!
//! `eval $(harness config source)` feeds resolved values — including secrets
//! pulled from 1Password — back into a shell. Emitting `export K="$value"`
//! with double quotes is unsafe: inside double quotes a POSIX shell still
//! performs command substitution (`$(...)`, backticks) and parameter
//! expansion, so a value like `$(rm -rf ~)` would execute on `eval`.
//!
//! Single quotes are the only POSIX construct with NO inner expansion at all.
//! The single non-representable byte is `'` itself, which we emit by closing
//! the quote, adding an escaped literal quote, and reopening: `'\''`.

/// Wrap `s` in single quotes so it is a single, fully-literal shell word.
///
/// The result is safe to `eval`: no command substitution, parameter
/// expansion, globbing, or word-splitting occurs inside single quotes.
pub fn single_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            // close quote, escaped literal ', reopen quote
            out.push_str("'\\''");
        } else {
            out.push(c);
        }
    }
    out.push('\'');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_plain_value_in_single_quotes() {
        assert_eq!(single_quote("hello"), "'hello'");
    }

    #[test]
    fn neutralizes_command_substitution() {
        // The whole point: $(...) must not be expandable after eval.
        assert_eq!(single_quote("$(rm -rf ~)"), "'$(rm -rf ~)'");
    }

    #[test]
    fn neutralizes_backticks_and_parameter_expansion() {
        assert_eq!(single_quote("`id`"), "'`id`'");
        assert_eq!(single_quote("$HOME"), "'$HOME'");
    }

    #[test]
    fn escapes_embedded_single_quote() {
        // o'reilly -> 'o'\''reilly'
        assert_eq!(single_quote("o'reilly"), "'o'\\''reilly'");
    }

    #[test]
    fn handles_empty_string() {
        assert_eq!(single_quote(""), "''");
    }

    #[test]
    fn preserves_significant_whitespace() {
        assert_eq!(single_quote("  spaced  "), "'  spaced  '");
    }
}
