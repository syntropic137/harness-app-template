//! harness-versioning release discipline.
//! Implements ADR-0011-versioning.

#![forbid(unsafe_code)]

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand, ValueEnum};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

#[derive(Parser, Debug)]
#[command(
    name = "harness-versioning",
    version,
    about = "Versioning slot orchestrator."
)]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Validate conventional commits and changelog generation for a commit range.
    Check {
        /// Project root.
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Mode: whole-repo uses the root CHANGELOG.md; per-package is accepted as a no-op.
        #[arg(long, value_enum, default_value_t = Mode::WholeRepo)]
        mode: Mode,
        /// Start revision. Defaults to the latest v* tag, or all history when no tag exists.
        #[arg(long)]
        from: Option<String>,
        /// End revision.
        #[arg(long, default_value = "HEAD")]
        to: String,
    },
    /// CI-focused alias for check.
    CiCheck {
        /// Project root.
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Start revision. Defaults to the latest v* tag, or all history when no tag exists.
        #[arg(long)]
        from: Option<String>,
        /// End revision.
        #[arg(long, default_value = "HEAD")]
        to: String,
    },
    /// Print the next version and generated changelog entries.
    Plan {
        /// Project root.
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Start revision. Defaults to the latest v* tag, or all history when no tag exists.
        #[arg(long)]
        from: Option<String>,
        /// End revision.
        #[arg(long, default_value = "HEAD")]
        to: String,
    },
    /// Update CHANGELOG.md, commit it, and create an annotated release tag.
    Release {
        /// Project root.
        #[arg(default_value = ".")]
        root: PathBuf,
        /// Release level. Auto derives from conventional commits.
        #[arg(long, value_enum, default_value_t = RequestedLevel::Auto)]
        level: RequestedLevel,
        /// Start revision. Defaults to the latest v* tag, or all history when no tag exists.
        #[arg(long)]
        from: Option<String>,
        /// End revision.
        #[arg(long, default_value = "HEAD")]
        to: String,
        /// Apply the release. Without this flag the command is a dry run.
        #[arg(long)]
        execute: bool,
    },
}

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    WholeRepo,
    PerPackage,
}

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestedLevel {
    Auto,
    Patch,
    Minor,
    Major,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum BumpLevel {
    Patch,
    Minor,
    Major,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Version {
    major: u64,
    minor: u64,
    patch: u64,
}

#[derive(Clone, Debug)]
struct Commit {
    hash: String,
    parents: Vec<String>,
    subject: String,
    body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ConventionalCommit {
    commit_type: String,
    scope: Option<String>,
    description: String,
    breaking: bool,
}

#[derive(Clone, Debug)]
struct ReleasePlan {
    from: Option<String>,
    to: String,
    base_version: Version,
    next_version: Version,
    level: BumpLevel,
    commits: Vec<(Commit, ConventionalCommit)>,
}

pub fn run(cli: Cli) -> Result<ExitCode> {
    match cli.cmd {
        Cmd::Check {
            root,
            mode,
            from,
            to,
        } => check_versioning(root, mode, from, to),
        Cmd::CiCheck { root, from, to } => check_versioning(root, Mode::WholeRepo, from, to),
        Cmd::Plan { root, from, to } => {
            let root = normalize_root(root);
            let plan = build_release_plan(&root, from, to, RequestedLevel::Auto)?;
            print_plan(&plan);
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Release {
            root,
            level,
            from,
            to,
            execute,
        } => release(root, level, from, to, execute),
    }
}

fn check_versioning(
    root: PathBuf,
    mode: Mode,
    from: Option<String>,
    to: String,
) -> Result<ExitCode> {
    let root = normalize_root(root);
    match mode {
        Mode::WholeRepo => check_whole_repo(&root, from, to),
        Mode::PerPackage => {
            eprintln!("warn: per-package mode is not implemented yet; use --mode whole-repo");
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn check_whole_repo(root: &Path, from: Option<String>, to: String) -> Result<ExitCode> {
    ensure_changelog_shape(root)?;
    let explicit_range = matches!(from.as_deref(), Some(rev) if !rev.trim().is_empty());
    let plan = build_release_plan(root, from, to, RequestedLevel::Auto)?;

    if plan.commits.is_empty() {
        if explicit_range {
            eprintln!("error: checked range has no changelog eligible commits");
            return Ok(ExitCode::from(1));
        }
        println!("versioning: no commits to validate in range");
        return Ok(ExitCode::SUCCESS);
    }

    println!(
        "versioning: {} conventional commits generate changelog entries for v{}",
        plan.commits.len(),
        plan.next_version
    );
    Ok(ExitCode::SUCCESS)
}

fn release(
    root: PathBuf,
    requested_level: RequestedLevel,
    from: Option<String>,
    to: String,
    execute: bool,
) -> Result<ExitCode> {
    let root = normalize_root(root);
    let current = ensure_changelog_shape(&root)?;
    let plan = build_release_plan(&root, from, to, requested_level)?;
    print_plan(&plan);

    if !execute {
        println!("versioning: dry run complete; pass --execute to apply");
        return Ok(ExitCode::SUCCESS);
    }

    if plan.commits.is_empty() {
        eprintln!("error: release requires at least one changelog eligible commit");
        return Ok(ExitCode::from(1));
    }

    ensure_clean_tracked_worktree(&root)?;
    let tag = format!("v{}", plan.next_version);
    ensure_tag_missing(&root, &tag)?;
    let changelog_path = root.join("CHANGELOG.md");
    let date = release_date(&root)?;
    let updated = render_changelog_release(&current, &plan, &date)?;
    std::fs::write(&changelog_path, updated)
        .context(format!("write {}", changelog_path.display()))?;
    update_manifest_version(&root, &plan.next_version)?;

    git(&root, &["add", "CHANGELOG.md", "harness.manifest.json"])?;
    let commit_message = format!("chore(release): {tag}");
    let commit_args = ["commit", "-m", commit_message.as_str(), "--no-verify"];
    git(&root, &commit_args)?;
    git(&root, &["tag", "-a", &tag, "-m", &format!("Release {tag}")])?;
    println!("versioning: created release commit and tag {tag}");
    Ok(ExitCode::SUCCESS)
}

fn build_release_plan(
    root: &Path,
    from: Option<String>,
    to: String,
    requested_level: RequestedLevel,
) -> Result<ReleasePlan> {
    let resolved_from = match from {
        Some(rev) if !rev.trim().is_empty() => Some(rev),
        _ => latest_release_tag(root, &to)?,
    };
    let base_version = match &resolved_from {
        Some(tag) => Version::parse_tag(tag).unwrap_or_else(Version::zero),
        None => Version::zero(),
    };
    let commits = collect_commits(root, resolved_from.as_deref(), &to)?;
    let parsed = parse_commits(commits)?;
    let derived = derive_level(&parsed).unwrap_or(BumpLevel::Patch);
    let level = match requested_level {
        RequestedLevel::Auto => derived,
        RequestedLevel::Patch => BumpLevel::Patch,
        RequestedLevel::Minor => BumpLevel::Minor,
        RequestedLevel::Major => BumpLevel::Major,
    };
    let next_version = base_version.bump(level);

    Ok(ReleasePlan {
        from: resolved_from,
        to,
        base_version,
        next_version,
        level,
        commits: parsed,
    })
}

fn collect_commits(root: &Path, from: Option<&str>, to: &str) -> Result<Vec<Commit>> {
    let range = match from {
        Some(from) => format!("{from}..{to}"),
        None => to.to_string(),
    };
    let args = [
        "log",
        "--reverse",
        "--format=%H%x1f%P%x1f%s%x1f%b%x1e",
        &range,
    ];
    let output = git_output(root, &args)?;
    let mut commits = Vec::new();

    for record in output.split('\u{1e}') {
        let record = record.trim_matches('\n');
        if record.trim().is_empty() {
            continue;
        }
        let mut fields = record.splitn(4, '\u{1f}');
        let hash = fields.next().unwrap_or_default().to_string();
        let parents = fields
            .next()
            .unwrap_or_default()
            .split_whitespace()
            .map(ToOwned::to_owned)
            .collect();
        let subject = fields.next().unwrap_or_default().to_string();
        let body = fields.next().unwrap_or_default().trim().to_string();

        commits.push(Commit {
            hash,
            parents,
            subject,
            body,
        });
    }

    Ok(commits)
}

fn parse_commits(commits: Vec<Commit>) -> Result<Vec<(Commit, ConventionalCommit)>> {
    let mut parsed = Vec::new();
    let mut invalid = Vec::new();

    for commit in commits {
        if commit.parents.len() > 1 || commit.subject.starts_with("Merge ") {
            continue;
        }

        match parse_conventional(&commit.subject, &commit.body) {
            Some(conventional) => parsed.push((commit, conventional)),
            None => invalid.push(format!("{} {}", short_hash(&commit.hash), commit.subject)),
        }
    }

    if !invalid.is_empty() {
        let mut lines = Vec::new();
        for line in invalid {
            lines.push(format!("  - {line}"));
        }
        bail!("non-conventional commits found:\n{}", lines.join("\n"));
    }

    Ok(parsed)
}

fn parse_conventional(subject: &str, body: &str) -> Option<ConventionalCommit> {
    let colon = subject.find(':')?;
    let mut header = subject[..colon].trim();
    let description = subject[colon + 1..].trim();
    if header.is_empty() || description.is_empty() {
        return None;
    }

    let mut breaking = header.ends_with('!') || has_breaking_footer(body);
    if header.ends_with('!') {
        header = &header[..header.len() - 1];
    }

    let (commit_type, scope) = if let Some(open) = header.find('(') {
        if !header.ends_with(')') || open == 0 {
            return None;
        }
        let close = header.len() - 1;
        let commit_type = &header[..open];
        let scope = &header[open + 1..close];
        if scope.is_empty() {
            return None;
        }
        (commit_type, Some(scope.to_string()))
    } else {
        (header, None)
    };

    if !is_valid_type(commit_type) {
        return None;
    }

    breaking |= has_breaking_footer(body);
    Some(ConventionalCommit {
        commit_type: commit_type.to_string(),
        scope,
        description: description.to_string(),
        breaking,
    })
}

fn has_breaking_footer(body: &str) -> bool {
    for line in body.lines() {
        let line = line.trim_start();
        if line.starts_with("BREAKING CHANGE:") || line.starts_with("BREAKING-CHANGE:") {
            return true;
        }
    }
    false
}

fn is_valid_type(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn derive_level(commits: &[(Commit, ConventionalCommit)]) -> Option<BumpLevel> {
    commits.iter().map(|(_, parsed)| bump_for(parsed)).max()
}

fn bump_for(parsed: &ConventionalCommit) -> BumpLevel {
    if parsed.breaking {
        return BumpLevel::Major;
    }

    match parsed.commit_type.as_str() {
        "feat" => BumpLevel::Minor,
        _ => BumpLevel::Patch,
    }
}

fn ensure_changelog_shape(root: &Path) -> Result<String> {
    let changelog = root.join("CHANGELOG.md");
    if !changelog.is_file() {
        bail!("CHANGELOG.md missing at {}", changelog.display());
    }
    let content =
        std::fs::read_to_string(&changelog).context(format!("read {}", changelog.display()))?;
    if !content.lines().any(|line| line.trim() == "## [Unreleased]") {
        bail!("CHANGELOG.md must contain a ## [Unreleased] section");
    }
    Ok(content)
}

fn update_manifest_version(root: &Path, version: &Version) -> Result<()> {
    let manifest = root.join("harness.manifest.json");
    let content =
        std::fs::read_to_string(&manifest).context(format!("read {}", manifest.display()))?;
    let updated = replace_manifest_version_text(&content, version)
        .context(format!("update {}", manifest.display()))?;
    std::fs::write(&manifest, updated).context(format!("write {}", manifest.display()))?;
    Ok(())
}

fn replace_manifest_version_text(content: &str, version: &Version) -> Result<String> {
    let parsed: serde_json::Value =
        serde_json::from_str(content).context("harness.manifest.json is not valid JSON")?;
    parsed
        .as_object()
        .and_then(|object| object.get("version"))
        .and_then(serde_json::Value::as_str)
        .context("harness.manifest.json must contain a top-level string version field")?;

    let next = version.to_string();
    let mut updated = String::with_capacity(content.len() + next.len());
    let mut replaced = false;

    for segment in content.split_inclusive('\n') {
        let (line, newline) = match segment.strip_suffix('\n') {
            Some(line) => (line, "\n"),
            None => (segment, ""),
        };
        let trimmed_start = line.trim_start();
        let indent_len = line.len() - trimmed_start.len();
        let is_top_level_version = if indent_len == 2 {
            match trimmed_start.strip_prefix("\"version\"") {
                Some(rest) => rest.trim_start().starts_with(':'),
                None => false,
            }
        } else {
            false
        };

        if !replaced && is_top_level_version {
            let trimmed_end = line.trim_end();
            let trailing_ws = &line[trimmed_end.len()..];
            let comma = if trimmed_end.ends_with(',') { "," } else { "" };
            updated.push_str(&line[..indent_len]);
            updated.push_str(&format!("\"version\": \"{next}\"{comma}"));
            updated.push_str(trailing_ws);
            updated.push_str(newline);
            replaced = true;
        } else {
            updated.push_str(segment);
        }
    }

    if !replaced {
        bail!("could not find the top-level version field line in harness.manifest.json");
    }

    Ok(updated)
}

fn render_changelog_release(content: &str, plan: &ReleasePlan, date: &str) -> Result<String> {
    let heading = "## [Unreleased]";
    let start = content
        .find(heading)
        .context("CHANGELOG.md must contain ## [Unreleased]")?;
    let section_start = start + heading.len();
    let next_heading = content[section_start..]
        .find("\n## [")
        .map(|index| section_start + index);
    let (before, after) = match next_heading {
        Some(index) => (&content[..start], &content[index + 1..]),
        None => (&content[..start], ""),
    };
    let existing_unreleased = content[section_start..next_heading.unwrap_or(content.len())]
        .lines()
        .filter(|line| line.trim() != "- (Add your first changelog entry here.)")
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    let generated = render_release_body(plan);
    let mut release_body = String::new();
    if !existing_unreleased.is_empty() {
        release_body.push_str(&existing_unreleased);
        release_body.push_str("\n\n");
    }
    release_body.push_str(&generated);

    let mut updated = String::new();
    updated.push_str(before.trim_end());
    updated.push_str("\n\n");
    updated.push_str(heading);
    updated.push_str("\n\n");
    updated.push_str(&format!("## [{}] - {date}\n\n", plan.next_version));
    updated.push_str(release_body.trim_end());
    updated.push('\n');
    if !after.trim().is_empty() {
        updated.push('\n');
        updated.push_str(after.trim_start());
    }
    Ok(updated)
}

fn render_release_body(plan: &ReleasePlan) -> String {
    let mut sections: BTreeMap<&'static str, Vec<String>> = BTreeMap::new();
    for (commit, parsed) in &plan.commits {
        let section = if parsed.breaking {
            "Breaking Changes"
        } else {
            section_for_type(&parsed.commit_type)
        };
        sections.entry(section).or_default().push(format!(
            "- {}{} ({})",
            scope_prefix(parsed.scope.as_deref()),
            changelog_text(&parsed.description),
            short_hash(&commit.hash)
        ));
    }

    let mut rendered = String::new();
    for section in [
        "Breaking Changes",
        "Added",
        "Fixed",
        "Changed",
        "Performance",
        "Documentation",
        "Maintenance",
        "Harness Work",
        "Other",
    ] {
        let Some(entries) = sections.get(section) else {
            continue;
        };
        if !rendered.is_empty() {
            rendered.push('\n');
        }
        rendered.push_str(&format!("### {section}\n\n"));
        rendered.push_str(&entries.join("\n"));
        rendered.push('\n');
    }
    rendered
}

fn section_for_type(commit_type: &str) -> &'static str {
    match commit_type {
        "feat" => "Added",
        "fix" => "Fixed",
        "refactor" => "Changed",
        "perf" => "Performance",
        "docs" => "Documentation",
        "build" | "chore" | "ci" | "style" | "test" => "Maintenance",
        "experiments" | "plan" | "proposal" | "retrospective" => "Harness Work",
        _ => "Other",
    }
}

fn scope_prefix(scope: Option<&str>) -> String {
    match scope {
        Some(scope) => format!("**{scope}:** "),
        None => String::new(),
    }
}

fn changelog_text(value: &str) -> String {
    value.replace(['\u{2013}', '\u{2014}'], "-")
}

fn print_plan(plan: &ReleasePlan) {
    println!(
        "versioning: {} -> v{} ({:?})",
        plan.base_version, plan.next_version, plan.level
    );
    match &plan.from {
        Some(from) => println!("versioning: range {from}..{}", plan.to),
        None => println!("versioning: range {}", plan.to),
    }
    if plan.commits.is_empty() {
        println!("versioning: no changelog entries");
    } else {
        print!("{}", render_release_body(plan));
    }
}

fn latest_release_tag(root: &Path, to: &str) -> Result<Option<String>> {
    let args = [
        "tag",
        "--merged",
        to,
        "--list",
        "v[0-9]*",
        "--sort=-v:refname",
    ];
    let output = git_output(root, &args)?;
    for line in output.lines() {
        let line = line.trim();
        if Version::parse_tag(line).is_some() {
            return Ok(Some(line.to_string()));
        }
    }
    Ok(None)
}

fn ensure_tag_missing(root: &Path, tag: &str) -> Result<()> {
    let status = Command::new("git")
        .args(["rev-parse", "-q", "--verify", &format!("refs/tags/{tag}")])
        .current_dir(root)
        .status()
        .context("run git rev-parse")?;
    if status.success() {
        bail!("tag {tag} already exists");
    }
    Ok(())
}

fn ensure_clean_tracked_worktree(root: &Path) -> Result<()> {
    let status = git_output(root, &["status", "--porcelain", "--untracked-files=no"])?;
    if !status.trim().is_empty() {
        bail!("release requires a clean tracked worktree");
    }
    Ok(())
}

fn release_date(root: &Path) -> Result<String> {
    let env_value = std::env::var("HARNESS_RELEASE_DATE").ok();
    release_date_from_override(root, env_value.as_deref())
}

fn release_date_from_override(root: &Path, value: Option<&str>) -> Result<String> {
    if let Some(value) = release_date_from_env(value) {
        return Ok(value);
    }

    system_release_date(root)
}

fn release_date_from_env(value: Option<&str>) -> Option<String> {
    value
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn system_release_date(root: &Path) -> Result<String> {
    let output = Command::new("date")
        .arg("+%F")
        .current_dir(root)
        .output()
        .context("run date +%F")?;
    date_from_output(output.status.success(), output.stdout)
}

fn date_from_output(success: bool, stdout: Vec<u8>) -> Result<String> {
    if success {
        return Ok(String::from_utf8(stdout)?.trim().to_string());
    }
    bail!("date +%F failed")
}

fn normalize_root(root: PathBuf) -> PathBuf {
    root.canonicalize().unwrap_or(root)
}

fn git(root: &Path, args: &[&str]) -> Result<()> {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .context("run git")?;
    if !status.success() {
        bail!("git command failed");
    }
    Ok(())
}

fn git_output(root: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .context("run git")?;
    if !output.status.success() {
        bail!(
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn short_hash(hash: &str) -> String {
    hash.chars().take(7).collect()
}

impl Version {
    fn zero() -> Self {
        Self {
            major: 0,
            minor: 0,
            patch: 0,
        }
    }

    fn parse_tag(tag: &str) -> Option<Self> {
        let tag = tag.strip_prefix('v')?;
        let parts = tag.split('.').collect::<Vec<_>>();
        if parts.len() != 3 {
            return None;
        }
        let Ok(major) = parts[0].parse() else {
            return None;
        };
        let Ok(minor) = parts[1].parse() else {
            return None;
        };
        let Ok(patch) = parts[2].parse() else {
            return None;
        };
        Some(Self {
            major,
            minor,
            patch,
        })
    }

    fn bump(&self, level: BumpLevel) -> Self {
        match level {
            BumpLevel::Patch => Self {
                major: self.major,
                minor: self.minor,
                patch: self.patch + 1,
            },
            BumpLevel::Minor => Self {
                major: self.major,
                minor: self.minor + 1,
                patch: 0,
            },
            BumpLevel::Major => Self {
                major: self.major + 1,
                minor: 0,
                patch: 0,
            },
        }
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::path::Path;
    use std::process::Command;

    fn run_git<const N: usize, S>(root: &Path, args: [S; N])
    where
        S: AsRef<OsStr>,
    {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .expect("spawn git");
        assert!(output.status.success());
    }

    fn seed_repo(subject: &str) -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        run_git(tmp.path(), ["init"]);
        run_git(tmp.path(), ["config", "user.email", "test@example.com"]);
        run_git(tmp.path(), ["config", "user.name", "Harness Test"]);
        std::fs::write(
            tmp.path().join("CHANGELOG.md"),
            "# Changelog\n\n## [Unreleased]\n\n- (Add your first changelog entry here.)\n",
        )
        .unwrap();
        std::fs::write(
            tmp.path().join("harness.manifest.json"),
            "{\n  \"name\": \"test-harness\",\n  \"version\": \"0.0.0\",\n  \"slots\": {}\n}\n",
        )
        .unwrap();
        run_git(tmp.path(), ["add", "CHANGELOG.md", "harness.manifest.json"]);
        run_git(tmp.path(), ["commit", "-m", subject]);
        tmp
    }

    fn parsed_pair(subject: &str, body: &str) -> (Commit, ConventionalCommit) {
        let parsed = parse_conventional(subject, body).unwrap();
        (
            Commit {
                hash: format!("{subject:0<12}"),
                parents: vec!["parent".to_string()],
                subject: subject.to_string(),
                body: body.to_string(),
            },
            parsed,
        )
    }

    fn plan_with(commits: Vec<(Commit, ConventionalCommit)>) -> ReleasePlan {
        ReleasePlan {
            from: None,
            to: "HEAD".to_string(),
            base_version: Version::zero(),
            next_version: Version {
                major: 1,
                minor: 2,
                patch: 3,
            },
            level: BumpLevel::Minor,
            commits,
        }
    }

    #[test]
    fn parses_conventional_commit_with_scope_and_breaking_marker() {
        let parsed = parse_conventional("feat(api)!: add stable endpoint", "").unwrap();
        assert_eq!(parsed.commit_type, "feat");
        assert_eq!(parsed.scope.as_deref(), Some("api"));
        assert_eq!(parsed.description, "add stable endpoint");
        assert!(parsed.breaking);
        assert!(has_breaking_footer("details\nBREAKING-CHANGE: renamed API"));
    }

    #[test]
    fn rejects_non_conventional_subject() {
        assert!(parse_conventional("update things", "").is_none());
        assert!(parse_conventional("feat: ", "").is_none());
        assert!(parse_conventional("Feat: uppercase type", "").is_none());
    }

    #[test]
    fn derives_highest_bump_level() {
        let commit = Commit {
            hash: "abcdef123".to_string(),
            parents: vec!["parent".to_string()],
            subject: "feat: add thing".to_string(),
            body: String::new(),
        };
        let parsed = vec![
            (
                commit.clone(),
                parse_conventional("fix: repair thing", "").unwrap(),
            ),
            (
                commit,
                parse_conventional("feat: add thing", "BREAKING CHANGE: shape changed").unwrap(),
            ),
        ];
        assert_eq!(derive_level(&parsed), Some(BumpLevel::Major));
    }

    #[test]
    fn renders_changelog_release_and_removes_placeholder() {
        let plan = ReleasePlan {
            from: None,
            to: "HEAD".to_string(),
            base_version: Version::zero(),
            next_version: Version {
                major: 0,
                minor: 1,
                patch: 0,
            },
            level: BumpLevel::Minor,
            commits: vec![(
                Commit {
                    hash: "abcdef123456".to_string(),
                    parents: vec![],
                    subject: "feat(ui): add release panel".to_string(),
                    body: String::new(),
                },
                parse_conventional("feat(ui): add release panel", "").unwrap(),
            )],
        };
        let changelog =
            "# Changelog\n\n## [Unreleased]\n\n- (Add your first changelog entry here.)\n";
        let updated = render_changelog_release(changelog, &plan, "2026-06-02").unwrap();
        assert!(updated.contains("## [Unreleased]\n\n## [0.1.0] - 2026-06-02"));
        assert!(updated.contains("- **ui:** add release panel (abcdef1)"));
        assert!(!updated.contains("Add your first changelog entry"));
    }

    #[test]
    fn check_requires_unreleased_section() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("CHANGELOG.md"), "# Changelog\n").unwrap();
        let err = ensure_changelog_shape(tmp.path()).unwrap_err();
        assert!(err.to_string().contains("Unreleased"));
    }

    #[test]
    fn changelog_text_uses_ascii_hyphens() {
        assert_eq!(changelog_text("a\u{2013}b and c\u{2014}d"), "a-b and c-d");
    }

    #[test]
    fn manifest_version_update_preserves_slot_versions() {
        let manifest = "{\n  \"name\": \"x\",\n  \"version\": \"0.4.0\",\n  \"slots\": {\n    \"versioning\": {\n      \"version\": \"0.1.0\"\n    }\n  }\n}\n";
        let version = Version {
            major: 1,
            minor: 2,
            patch: 3,
        };
        let updated = replace_manifest_version_text(manifest, &version).unwrap();
        assert!(updated.contains("  \"version\": \"1.2.3\","));
        assert!(updated.contains("      \"version\": \"0.1.0\""));
    }

    #[test]
    fn run_plan_command_succeeds() {
        let tmp = seed_repo("feat: seed release plan");
        let code = run(Cli {
            cmd: Cmd::Plan {
                root: tmp.path().to_path_buf(),
                from: None,
                to: "HEAD".to_string(),
            },
        })
        .unwrap();

        assert_eq!(code, ExitCode::SUCCESS);
    }

    #[test]
    fn run_dispatches_check_ci_and_release_paths() {
        let tmp = seed_repo("feat: seed release dispatch");

        let code = run(Cli {
            cmd: Cmd::Check {
                root: tmp.path().to_path_buf(),
                mode: Mode::WholeRepo,
                from: None,
                to: "HEAD".to_string(),
            },
        })
        .unwrap();
        assert_eq!(code, ExitCode::SUCCESS);

        let code = run(Cli {
            cmd: Cmd::Check {
                root: tmp.path().to_path_buf(),
                mode: Mode::PerPackage,
                from: None,
                to: "HEAD".to_string(),
            },
        })
        .unwrap();
        assert_eq!(code, ExitCode::SUCCESS);

        let code = run(Cli {
            cmd: Cmd::CiCheck {
                root: tmp.path().to_path_buf(),
                from: None,
                to: "HEAD".to_string(),
            },
        })
        .unwrap();
        assert_eq!(code, ExitCode::SUCCESS);

        let code = run(Cli {
            cmd: Cmd::Release {
                root: tmp.path().to_path_buf(),
                level: RequestedLevel::Auto,
                from: None,
                to: "HEAD".to_string(),
                execute: false,
            },
        })
        .unwrap();
        assert_eq!(code, ExitCode::SUCCESS);
    }

    #[test]
    fn implicit_empty_range_succeeds_after_latest_tag() {
        let tmp = seed_repo("fix: seed release range");
        run_git(tmp.path(), ["tag", "-a", "v0.0.1", "-m", "Release v0.0.1"]);

        let code = check_whole_repo(tmp.path(), None, "HEAD".to_string()).unwrap();

        assert_eq!(code, ExitCode::SUCCESS);
    }

    #[test]
    fn check_whole_repo_explicit_range_without_commits_returns_error() {
        let tmp = seed_repo("fix: seed explicit empty range");
        let head = git_output(tmp.path(), &["rev-parse", "HEAD"]).unwrap();
        let head = head.trim();

        let code =
            check_whole_repo(tmp.path(), Some(head.to_string()), "HEAD".to_string()).unwrap();

        assert_eq!(code, ExitCode::from(1));
    }

    #[test]
    fn check_versioning_direct_paths_succeed() {
        let tmp = seed_repo("feat: seed direct check");

        let whole_repo = check_versioning(
            tmp.path().to_path_buf(),
            Mode::WholeRepo,
            None,
            "HEAD".to_string(),
        )
        .unwrap();
        let per_package = check_versioning(
            tmp.path().to_path_buf(),
            Mode::PerPackage,
            None,
            "HEAD".to_string(),
        )
        .unwrap();

        assert_eq!(whole_repo, ExitCode::SUCCESS);
        assert_eq!(per_package, ExitCode::SUCCESS);
    }

    #[test]
    fn release_execute_rejects_empty_plan() {
        let tmp = seed_repo("fix: seed release range");
        run_git(tmp.path(), ["tag", "-a", "v0.0.1", "-m", "Release v0.0.1"]);

        let code = release(
            tmp.path().to_path_buf(),
            RequestedLevel::Auto,
            None,
            "HEAD".to_string(),
            true,
        )
        .unwrap();

        assert_eq!(code, ExitCode::from(1));
    }

    #[test]
    fn release_execute_direct_path_updates_manifest_and_tags() {
        let tmp = seed_repo("feat: direct release execution");

        let code = release(
            tmp.path().to_path_buf(),
            RequestedLevel::Auto,
            None,
            "HEAD".to_string(),
            true,
        )
        .unwrap();

        let manifest = std::fs::read_to_string(tmp.path().join("harness.manifest.json")).unwrap();
        let tags = git_output(tmp.path(), &["tag", "--list", "v0.1.0"]).unwrap();

        assert_eq!(code, ExitCode::SUCCESS);
        assert!(manifest.contains("\"version\": \"0.1.0\""));
        assert_eq!(tags.trim(), "v0.1.0");
    }

    #[test]
    fn build_release_plan_honors_requested_levels() {
        let tmp = seed_repo("fix: seed release range");
        run_git(tmp.path(), ["tag", "-a", "v1.2.3", "-m", "Release v1.2.3"]);

        let patch = build_release_plan(tmp.path(), None, "HEAD".to_string(), RequestedLevel::Patch)
            .unwrap();
        let minor = build_release_plan(tmp.path(), None, "HEAD".to_string(), RequestedLevel::Minor)
            .unwrap();
        let major = build_release_plan(tmp.path(), None, "HEAD".to_string(), RequestedLevel::Major)
            .unwrap();

        assert_eq!(patch.next_version.to_string(), "1.2.4");
        assert_eq!(minor.next_version.to_string(), "1.3.0");
        assert_eq!(major.next_version.to_string(), "2.0.0");
    }

    #[test]
    fn parse_commits_skips_merge_commits_and_bad_scopes() {
        let merge_parent_count = Commit {
            hash: "abcdef123456".to_string(),
            parents: vec!["one".to_string(), "two".to_string()],
            subject: "feat: merge parent count".to_string(),
            body: String::new(),
        };
        let merge_subject = Commit {
            hash: "fedcba654321".to_string(),
            parents: vec!["one".to_string()],
            subject: "Merge branch main".to_string(),
            body: String::new(),
        };

        let parsed = parse_commits(vec![merge_parent_count, merge_subject]).unwrap();

        assert!(parsed.is_empty());
        assert!(parse_conventional("feat(api: missing close", "").is_none());
        assert!(parse_conventional("feat(): empty scope", "").is_none());
    }

    #[test]
    fn parse_commits_reports_invalid_commit_lines() {
        let invalid = Commit {
            hash: "abcdef123456".to_string(),
            parents: vec!["one".to_string()],
            subject: "oops not conventional".to_string(),
            body: String::new(),
        };
        let missing_description = Commit {
            hash: "123456abcdef".to_string(),
            parents: vec!["one".to_string()],
            subject: "feat():".to_string(),
            body: String::new(),
        };

        let err = parse_commits(vec![invalid, missing_description]).unwrap_err();

        assert!(err.to_string().contains("non-conventional commits found"));
        assert!(err.to_string().contains("abcdef1 oops not conventional"));
        assert!(err.to_string().contains("123456a feat():"));
    }

    #[test]
    fn ensure_changelog_shape_reports_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let error = ensure_changelog_shape(tmp.path()).unwrap_err();
        assert!(error.to_string().contains("CHANGELOG.md missing"));
    }

    #[test]
    fn manifest_version_update_handles_no_newline_and_missing_line() {
        let version = Version {
            major: 2,
            minor: 0,
            patch: 0,
        };
        let updated =
            replace_manifest_version_text("{\n  \"version\": \"1.0.0\"\n}", &version).unwrap();
        assert!(updated.contains("\"version\": \"2.0.0\""));

        let error = replace_manifest_version_text("{\"version\":\"1.0.0\"}", &version).unwrap_err();
        assert!(error.to_string().contains("top-level version field line"));
    }

    #[test]
    fn changelog_release_preserves_existing_unreleased_and_history() {
        let plan = plan_with(vec![parsed_pair("fix: repair release notes", "")]);
        let changelog = "# Changelog\n\n## [Unreleased]\n\n- Keep manual note\n\n## [0.1.0] - 2026-01-01\n\n- Old note\n";

        let updated = render_changelog_release(changelog, &plan, "2026-06-03").unwrap();

        assert!(updated.contains("- Keep manual note\n\n### Fixed"));
        assert!(updated.contains("## [0.1.0] - 2026-01-01"));
    }

    #[test]
    fn render_release_body_covers_all_sections() {
        let plan = plan_with(vec![
            parsed_pair("feat!: break api", ""),
            parsed_pair("feat: add thing", ""),
            parsed_pair("fix: repair thing", ""),
            parsed_pair("refactor: reshape thing", ""),
            parsed_pair("perf: speed thing", ""),
            parsed_pair("docs: explain thing", ""),
            parsed_pair("chore: maintain thing", ""),
            parsed_pair("plan: align harness", ""),
            parsed_pair("deps: update thing", ""),
        ]);

        let rendered = render_release_body(&plan);

        for heading in [
            "Breaking Changes",
            "Added",
            "Fixed",
            "Changed",
            "Performance",
            "Documentation",
            "Maintenance",
            "Harness Work",
            "Other",
        ] {
            assert!(rendered.contains(&format!("### {heading}")));
        }
    }

    #[test]
    fn print_plan_handles_from_range_and_empty_commits() {
        let mut plan = plan_with(Vec::new());
        plan.from = Some("v1.2.2".to_string());

        print_plan(&plan);
    }

    #[test]
    fn latest_release_tag_ignores_invalid_tags() {
        let tmp = seed_repo("fix: seed tagged release");
        run_git(tmp.path(), ["tag", "v999"]);
        run_git(tmp.path(), ["tag", "not-version"]);
        run_git(tmp.path(), ["tag", "v1.2.3"]);

        let tag = latest_release_tag(tmp.path(), "HEAD").unwrap();

        assert_eq!(tag.as_deref(), Some("v1.2.3"));
    }

    #[test]
    fn git_guards_report_existing_tag_and_dirty_worktree() {
        let tmp = seed_repo("fix: seed guard checks");
        run_git(tmp.path(), ["tag", "v0.0.1"]);

        let tag_error = ensure_tag_missing(tmp.path(), "v0.0.1").unwrap_err();
        assert!(tag_error.to_string().contains("already exists"));

        std::fs::write(tmp.path().join("CHANGELOG.md"), "# changed\n").unwrap();
        let dirty_error = ensure_clean_tracked_worktree(tmp.path()).unwrap_err();
        assert!(dirty_error.to_string().contains("clean tracked worktree"));
    }

    #[test]
    fn release_date_helpers_cover_env_output_and_system_date() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(
            release_date_from_env(Some("2026-06-03")).as_deref(),
            Some("2026-06-03")
        );
        assert_eq!(release_date_from_env(Some("   ")), None);
        assert_eq!(release_date_from_env(None), None);

        let date_via_public_path = release_date(tmp.path()).unwrap();
        let date = system_release_date(tmp.path()).unwrap();
        let parsed = date_from_output(true, b"2026-06-03\n".to_vec()).unwrap();
        let error = date_from_output(false, Vec::new()).unwrap_err();

        assert_eq!(date_via_public_path.len(), 10);
        assert_eq!(date.len(), 10);
        assert_eq!(parsed, "2026-06-03");
        assert!(error.to_string().contains("date +%F failed"));

        let env_date = release_date_from_override(tmp.path(), Some("2026-06-04")).unwrap();
        assert_eq!(env_date, "2026-06-04");
    }

    #[test]
    fn git_helpers_report_failed_commands() {
        let tmp = tempfile::tempdir().unwrap();

        let status_error = git(tmp.path(), &["not-a-real-command"]).unwrap_err();
        let output_error = git_output(tmp.path(), &["not-a-real-command"]).unwrap_err();

        assert!(status_error.to_string().contains("git command failed"));
        assert!(output_error.to_string().contains("git command failed"));
    }

    #[test]
    fn command_context_errors_are_reported() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("missing");

        let tag_error = ensure_tag_missing(&missing, "v0.0.1").unwrap_err();
        let clean_error = ensure_clean_tracked_worktree(tmp.path()).unwrap_err();
        let date_error = system_release_date(&missing).unwrap_err();
        let git_error = git(&missing, &["status"]).unwrap_err();
        let git_output_error = git_output(&missing, &["status"]).unwrap_err();
        let utf8_error = date_from_output(true, vec![0xff]).unwrap_err();

        assert!(tag_error.to_string().contains("run git rev-parse"));
        assert!(clean_error.to_string().contains("git command failed"));
        assert!(date_error.to_string().contains("run date"));
        assert!(git_error.to_string().contains("run git"));
        assert!(git_output_error.to_string().contains("run git"));
        assert!(utf8_error.to_string().contains("invalid utf-8"));
    }

    #[cfg(unix)]
    #[test]
    fn file_context_errors_are_reported() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = tempfile::tempdir().unwrap();
        let changelog = tmp.path().join("CHANGELOG.md");
        std::fs::write(&changelog, "# Changelog\n\n## [Unreleased]\n").unwrap();
        let mut locked = std::fs::metadata(&changelog).unwrap().permissions();
        locked.set_mode(0o000);
        std::fs::set_permissions(&changelog, locked).unwrap();

        let changelog_error = ensure_changelog_shape(tmp.path()).unwrap_err();

        let mut restored = std::fs::metadata(&changelog).unwrap().permissions();
        restored.set_mode(0o600);
        std::fs::set_permissions(&changelog, restored).unwrap();

        let manifest_error = update_manifest_version(
            tmp.path(),
            &Version {
                major: 1,
                minor: 0,
                patch: 0,
            },
        )
        .unwrap_err();

        assert!(changelog_error.to_string().contains("read"));
        assert!(manifest_error.to_string().contains("read"));
    }

    #[test]
    fn release_and_plan_error_paths_are_reported() {
        let tmp = tempfile::tempdir().unwrap();
        let missing = tmp.path().join("missing");
        let plan_error = run(Cli {
            cmd: Cmd::Plan {
                root: tmp.path().to_path_buf(),
                from: None,
                to: "HEAD".to_string(),
            },
        })
        .unwrap_err();
        let check_error = check_whole_repo(tmp.path(), None, "HEAD".to_string()).unwrap_err();
        let release_shape_error = release(
            tmp.path().to_path_buf(),
            RequestedLevel::Auto,
            None,
            "HEAD".to_string(),
            false,
        )
        .unwrap_err();

        std::fs::write(
            tmp.path().join("CHANGELOG.md"),
            "# Changelog\n\n## [Unreleased]\n",
        )
        .unwrap();
        let release_plan_error = release(
            tmp.path().to_path_buf(),
            RequestedLevel::Auto,
            None,
            "HEAD".to_string(),
            false,
        )
        .unwrap_err();
        let plan_to_error = build_release_plan(
            tmp.path(),
            None,
            "missing-ref".to_string(),
            RequestedLevel::Auto,
        )
        .unwrap_err();
        let latest_error = latest_release_tag(&missing, "HEAD").unwrap_err();

        assert!(plan_error.to_string().contains("git command failed"));
        assert!(check_error.to_string().contains("CHANGELOG"));
        assert!(release_shape_error.to_string().contains("CHANGELOG"));
        assert!(
            release_plan_error
                .to_string()
                .contains("git command failed")
        );
        assert!(plan_to_error.to_string().contains("git command failed"));
        assert!(latest_error.to_string().contains("run git"));
    }

    #[test]
    fn release_execute_reports_dirty_existing_tag_and_missing_manifest() {
        let dirty = seed_repo("feat: dirty release execution");
        std::fs::write(
            dirty.path().join("CHANGELOG.md"),
            "# Changelog\n\n## [Unreleased]\n\n- dirty\n",
        )
        .unwrap();
        let dirty_error = release(
            dirty.path().to_path_buf(),
            RequestedLevel::Auto,
            None,
            "HEAD".to_string(),
            true,
        )
        .unwrap_err();

        let tagged = seed_repo("chore: initial release base");
        let base = git_output(tagged.path(), &["rev-parse", "HEAD"])
            .unwrap()
            .trim()
            .to_string();
        std::fs::write(tagged.path().join("feature.txt"), "x").unwrap();
        run_git(tagged.path(), ["add", "feature.txt"]);
        run_git(
            tagged.path(),
            ["commit", "-m", "feat: tagged release execution"],
        );
        run_git(tagged.path(), ["tag", "v0.1.0"]);
        let tag_error = release(
            tagged.path().to_path_buf(),
            RequestedLevel::Auto,
            Some(base),
            "HEAD".to_string(),
            true,
        )
        .unwrap_err();

        let missing_manifest = seed_repo("feat: missing manifest release");
        run_git(missing_manifest.path(), ["rm", "harness.manifest.json"]);
        run_git(
            missing_manifest.path(),
            ["commit", "-m", "chore: remove manifest"],
        );
        let manifest_error = release(
            missing_manifest.path().to_path_buf(),
            RequestedLevel::Auto,
            None,
            "HEAD".to_string(),
            true,
        )
        .unwrap_err();

        assert!(dirty_error.to_string().contains("clean tracked worktree"));
        assert!(tag_error.to_string().contains("already exists"));
        assert!(manifest_error.to_string().contains("harness.manifest.json"));
    }

    #[cfg(unix)]
    #[test]
    fn write_context_errors_are_reported() {
        use std::os::unix::fs::PermissionsExt;

        let release_root = seed_repo("feat: readonly changelog release");
        let changelog = release_root.path().join("CHANGELOG.md");
        let mut changelog_permissions = std::fs::metadata(&changelog).unwrap().permissions();
        changelog_permissions.set_mode(0o400);
        std::fs::set_permissions(&changelog, changelog_permissions).unwrap();

        let release_error = release(
            release_root.path().to_path_buf(),
            RequestedLevel::Auto,
            None,
            "HEAD".to_string(),
            true,
        )
        .unwrap_err();

        let mut restore_changelog = std::fs::metadata(&changelog).unwrap().permissions();
        restore_changelog.set_mode(0o600);
        std::fs::set_permissions(&changelog, restore_changelog).unwrap();

        let manifest_root = tempfile::tempdir().unwrap();
        let manifest = manifest_root.path().join("harness.manifest.json");
        std::fs::write(&manifest, "{\n  \"version\": \"0.0.0\"\n}\n").unwrap();
        let mut manifest_permissions = std::fs::metadata(&manifest).unwrap().permissions();
        manifest_permissions.set_mode(0o400);
        std::fs::set_permissions(&manifest, manifest_permissions).unwrap();

        let manifest_error = update_manifest_version(
            manifest_root.path(),
            &Version {
                major: 1,
                minor: 0,
                patch: 0,
            },
        )
        .unwrap_err();

        let mut restore_manifest = std::fs::metadata(&manifest).unwrap().permissions();
        restore_manifest.set_mode(0o600);
        std::fs::set_permissions(&manifest, restore_manifest).unwrap();

        assert!(release_error.to_string().contains("write"));
        assert!(manifest_error.to_string().contains("write"));
    }

    #[test]
    fn manifest_and_changelog_render_errors_are_reported() {
        let version = Version {
            major: 1,
            minor: 0,
            patch: 0,
        };
        let invalid_json = replace_manifest_version_text("not json", &version).unwrap_err();
        let missing_version =
            replace_manifest_version_text("{\"name\":\"x\"}", &version).unwrap_err();
        let changelog_error =
            render_changelog_release("# Changelog\n", &plan_with(Vec::new()), "2026-06-03")
                .unwrap_err();

        assert!(invalid_json.to_string().contains("not valid JSON"));
        assert!(
            missing_version
                .to_string()
                .contains("top-level string version")
        );
        assert!(changelog_error.to_string().contains("Unreleased"));
    }

    #[test]
    fn parses_tags_and_major_bumps() {
        assert_eq!(
            Version::parse_tag("v1.2.3"),
            Some(Version {
                major: 1,
                minor: 2,
                patch: 3,
            })
        );
        assert_eq!(Version::parse_tag("1.2.3"), None);
        assert_eq!(Version::parse_tag("v"), None);
        assert_eq!(Version::parse_tag("v1"), None);
        assert_eq!(Version::parse_tag("v1.2"), None);
        assert_eq!(Version::parse_tag("vx.2.3"), None);
        assert_eq!(Version::parse_tag("v1.two.3"), None);
        assert_eq!(Version::parse_tag("v1.2.x"), None);
        assert_eq!(Version::parse_tag("v1.2.3.4"), None);
        assert_eq!(
            Version {
                major: 1,
                minor: 2,
                patch: 3,
            }
            .bump(BumpLevel::Major),
            Version {
                major: 2,
                minor: 0,
                patch: 0,
            }
        );
    }
}
