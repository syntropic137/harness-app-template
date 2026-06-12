pub mod env;
pub mod op;
use crate::schema::ConfigFile;
use anyhow::Result;
use std::collections::HashMap;
pub fn resolve_all(_schema: &ConfigFile) -> Result<HashMap<String, String>> { todo!() }
