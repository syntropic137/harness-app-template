//! harness-versioning release discipline.
//! Implements ADR-0011-versioning.

#![forbid(unsafe_code)]

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand, ValueEnum};
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const LOCAL_GIT_ENV: &[&str] = &[
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
];

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
    let explicit_range = from.as_ref().is_some_and(|rev| !rev.trim().is_empty());
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
    ensure_changelog_shape(&root)?;
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
    let current = std::fs::read_to_string(&changelog_path)
        .with_context(|| format!("read {}", changelog_path.display()))?;
    let updated = render_changelog_release(&current, &plan, &release_date(&root)?)?;
    std::fs::write(&changelog_path, updated)
        .with_context(|| format!("write {}", changelog_path.display()))?;
    update_manifest_version(&root, &plan.next_version)?;

    git(&root, ["add", "CHANGELOG.md", "harness.manifest.json"])?;
    git(
        &root,
        [
            "commit",
            "-m",
            &format!("chore(release): {tag}"),
            "--no-verify",
        ],
    )?;
    git(&root, ["tag", "-a", &tag, "-m", &format!("Release {tag}")])?;
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
    let output = git_output(
        root,
        [
            "log",
            "--reverse",
            "--format=%H%x1f%P%x1f%s%x1f%b%x1e",
            &range,
        ],
    )?;
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
        bail!(
            "non-conventional commits found:\n{}",
            invalid
                .into_iter()
                .map(|line| format!("  - {line}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
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
    body.lines().any(|line| {
        let line = line.trim_start();
        line.starts_with("BREAKING CHANGE:") || line.starts_with("BREAKING-CHANGE:")
    })
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

fn ensure_changelog_shape(root: &Path) -> Result<()> {
    let changelog = root.join("CHANGELOG.md");
    if !changelog.is_file() {
        bail!("CHANGELOG.md missing at {}", changelog.display());
    }
    let content = std::fs::read_to_string(&changelog)
        .with_context(|| format!("read {}", changelog.display()))?;
    if !content.lines().any(|line| line.trim() == "## [Unreleased]") {
        bail!("CHANGELOG.md must contain a ## [Unreleased] section");
    }
    Ok(())
}

fn update_manifest_version(root: &Path, version: &Version) -> Result<()> {
    let manifest = root.join("harness.manifest.json");
    let content = std::fs::read_to_string(&manifest)
        .with_context(|| format!("read {}", manifest.display()))?;
    let updated = replace_manifest_version_text(&content, version)
        .with_context(|| format!("update {}", manifest.display()))?;
    std::fs::write(&manifest, updated).with_context(|| format!("write {}", manifest.display()))?;
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
        let is_top_level_version = indent_len == 2
            && trimmed_start
                .strip_prefix("\"version\"")
                .is_some_and(|rest| rest.trim_start().starts_with(':'));

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
    scope.map_or_else(String::new, |scope| format!("**{scope}:** "))
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
    let output = git_output(
        root,
        [
            "tag",
            "--merged",
            to,
            "--list",
            "v[0-9]*",
            "--sort=-v:refname",
        ],
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .find(|line| Version::parse_tag(line).is_some())
        .map(ToOwned::to_owned))
}

fn ensure_tag_missing(root: &Path, tag: &str) -> Result<()> {
    let status = git_command(root)
        .args(["rev-parse", "-q", "--verify", &format!("refs/tags/{tag}")])
        .status()
        .context("run git rev-parse")?;
    if status.success() {
        bail!("tag {tag} already exists");
    }
    Ok(())
}

fn ensure_clean_tracked_worktree(root: &Path) -> Result<()> {
    let status = git_output(root, ["status", "--porcelain", "--untracked-files=no"])?;
    if !status.trim().is_empty() {
        bail!("release requires a clean tracked worktree");
    }
    Ok(())
}

fn release_date(root: &Path) -> Result<String> {
    if let Ok(value) = std::env::var("HARNESS_RELEASE_DATE")
        && !value.trim().is_empty()
    {
        return Ok(value);
    }

    let output = Command::new("date")
        .arg("+%F")
        .current_dir(root)
        .output()
        .context("run date +%F")?;
    if output.status.success() {
        return Ok(String::from_utf8(output.stdout)?.trim().to_string());
    }

    bail!("date +%F failed")
}

fn normalize_root(root: PathBuf) -> PathBuf {
    root.canonicalize().unwrap_or(root)
}

fn git<const N: usize, S>(root: &Path, args: [S; N]) -> Result<()>
where
    S: AsRef<OsStr>,
{
    let status = git_command(root).args(args).status().context("run git")?;
    if !status.success() {
        bail!("git command failed");
    }
    Ok(())
}

fn git_output<const N: usize, S>(root: &Path, args: [S; N]) -> Result<String>
where
    S: AsRef<OsStr>,
{
    let output = git_command(root).args(args).output().context("run git")?;
    if !output.status.success() {
        bail!(
            "git command failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8(output.stdout)?)
}

fn git_command(root: &Path) -> Command {
    let mut command = Command::new("git");
    command.current_dir(root);
    for key in LOCAL_GIT_ENV {
        command.env_remove(key);
    }
    command
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
        let mut parts = tag.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch = parts.next()?.parse().ok()?;
        if parts.next().is_some() {
            return None;
        }
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

    #[test]
    fn parses_conventional_commit_with_scope_and_breaking_marker() {
        let parsed = parse_conventional("feat(api)!: add stable endpoint", "").unwrap();
        assert_eq!(parsed.commit_type, "feat");
        assert_eq!(parsed.scope.as_deref(), Some("api"));
        assert_eq!(parsed.description, "add stable endpoint");
        assert!(parsed.breaking);
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
    fn git_command_strips_local_git_env() {
        let command = git_command(Path::new("."));
        for expected_key in LOCAL_GIT_ENV {
            assert!(
                command
                    .get_envs()
                    .any(|(key, value)| key == OsStr::new(expected_key) && value.is_none()),
                "{expected_key} should be removed from git subprocesses"
            );
        }
    }
}
