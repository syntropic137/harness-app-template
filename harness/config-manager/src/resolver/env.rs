use crate::schema::Var;
use std::env;

pub fn resolve(var: &Var) -> Option<String> {
    env::var(&var.name).ok().or_else(|| var.default.clone())
}

#[cfg(test)]
#[allow(unsafe_code)]
mod tests {
    use super::*;
    use crate::schema::Var;
    use std::env;

    fn var(name: &str, default: Option<&str>) -> Var {
        Var {
            name: name.into(),
            description: String::new(),
            required: false,
            default: default.map(str::to_owned),
            op_ref: None,
            secret: false,
        }
    }

    #[test]
    fn resolves_from_environment() {
        // SAFETY: test-only; single-threaded test runner context.
        unsafe { env::set_var("TEST_RESOLVE_ENV_VAR_A", "from-env") };
        let v = var("TEST_RESOLVE_ENV_VAR_A", None);
        assert_eq!(resolve(&v), Some("from-env".to_string()));
        // SAFETY: test-only; single-threaded test runner context.
        unsafe { env::remove_var("TEST_RESOLVE_ENV_VAR_A") };
    }

    #[test]
    fn falls_back_to_default() {
        // SAFETY: test-only; single-threaded test runner context.
        unsafe { env::remove_var("TEST_RESOLVE_MISSING_B") };
        let v = var("TEST_RESOLVE_MISSING_B", Some("default-val"));
        assert_eq!(resolve(&v), Some("default-val".to_string()));
    }

    #[test]
    fn returns_none_when_missing_and_no_default() {
        // SAFETY: test-only; single-threaded test runner context.
        unsafe { env::remove_var("TEST_RESOLVE_NONE_C") };
        let v = var("TEST_RESOLVE_NONE_C", None);
        assert_eq!(resolve(&v), None);
    }
}
