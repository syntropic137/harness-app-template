use anyhow::Result;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ConfigFile {
    pub config: ConfigMeta,
    #[serde(rename = "var", default)]
    pub vars: Vec<Var>,
}

#[derive(Debug, Deserialize)]
pub struct ConfigMeta {
    pub version: String,
    pub app_prefix: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Var {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub required: bool,
    pub default: Option<String>,
    pub op_ref: Option<String>,
    #[serde(default)]
    pub secret: bool,
}

pub fn load(_path: &str) -> Result<ConfigFile> { todo!() }
