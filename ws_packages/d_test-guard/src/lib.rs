// ws_packages/d_test-guard/src/lib.rs

/// Panics immediately if `APP_ENV` is not `"test"`.
/// Call this as the first line of every mock constructor.
pub fn assert_test_env() {
    assert_env_value(std::env::var("APP_ENV").ok().as_deref());
}

/// Inner implementation — testable without env mutation.
fn assert_env_value(app_env: Option<&str>) {
    if app_env != Some("test") {
        panic!(
            "Mock instantiated outside test environment (APP_ENV={:?}). \
             Mocks may only run when APP_ENV=test.",
            app_env.unwrap_or("<unset>")
        );
    }
}

/// Convenience macro — call `assert_test_env!()` in mock constructors.
#[macro_export]
macro_rules! assert_test_env {
    () => {
        $crate::assert_test_env()
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_when_app_env_is_test() {
        assert_env_value(Some("test")); // must not panic
    }

    #[test]
    #[should_panic(expected = "Mock instantiated outside test environment")]
    fn panics_when_app_env_is_production() {
        assert_env_value(Some("production"));
    }

    #[test]
    #[should_panic(expected = "Mock instantiated outside test environment")]
    fn panics_when_app_env_is_unset() {
        assert_env_value(None);
    }
}
