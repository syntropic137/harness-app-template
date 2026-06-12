use crate::schema::Var;
use anyhow::Result;
pub fn is_available() -> bool { false }
pub fn resolve(_var: &Var, _app_prefix: &str) -> Result<Option<String>> { Ok(None) }
