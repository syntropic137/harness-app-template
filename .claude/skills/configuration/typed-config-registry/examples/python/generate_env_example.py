#!/usr/bin/env python3
"""Illustrative example: generate ``.env.example`` from the typed registry.

This file is illustrative, not load-bearing. Wire it into your project under
``scripts/`` (or wherever build scripts live) and invoke it from your task
runner (e.g. ``just gen-env``). The point is that the example file is emitted
from the registry, never hand-edited, so it cannot drift from the code.

Two modes:

  - ``python generate_env_example.py``                  emits .env.example
  - ``python generate_env_example.py --overlay .env``   adds missing keys to
    an existing .env file without overwriting existing values (idempotent
    overlay; principle 2). Removed-but-still-present keys are flagged, never
    deleted automatically.

Secure-handling guarantee: this script reads values from the target .env
only to preserve them in place. It never prints, logs, or otherwise echoes
those values. Output is restricted to counts and key names (which are not
secret; the registry already enumerates them publicly in .env.example).
Apply the same discipline to any extension: emit summaries about the file,
never the values inside it.

See the SLP at ../../../SKILL.md (principle 2) for the rationale.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from pydantic import SecretStr
from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

from config import Settings


def field_to_lines(name: str, info: FieldInfo) -> list[str]:
    """Render one Settings field as a comment-block + KEY=default line."""
    env_name = name.upper()
    description = (info.description or "").strip()
    default = info.default

    if default is PydanticUndefined or default is None:
        default_str = ""
    elif isinstance(default, SecretStr):
        default_str = ""
    elif isinstance(default, bool):
        default_str = "true" if default else "false"
    else:
        default_str = str(default)

    lines: list[str] = []
    if description:
        for chunk in _wrap(description, width=78):
            lines.append(f"# {chunk}")
    lines.append(f"{env_name}={default_str}")
    lines.append("")
    return lines


def _wrap(text: str, width: int) -> list[str]:
    """Soft-wrap to the given width, preserving sentence flow."""
    words = text.split()
    out: list[str] = []
    current = ""
    for word in words:
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= width:
            current = f"{current} {word}"
        else:
            out.append(current)
            current = word
    if current:
        out.append(current)
    return out


def render_example() -> str:
    """Walk the Settings class and emit the full .env.example body."""
    header = [
        "# .env.example",
        "#",
        "# Generated from config.py. Do not hand-edit; run the generator instead.",
        "# Copy to .env and fill in environment-specific values.",
        "",
    ]
    body: list[str] = []
    for name, info in Settings.model_fields.items():
        body.extend(field_to_lines(name, info))
    return "\n".join(header + body).rstrip() + "\n"


def overlay_into(env_path: Path) -> tuple[int, int, list[str]]:
    """Add missing registry keys to env_path; preserve existing values.

    Values from the target file are held in memory only long enough to write
    them back. They are never returned, printed, or logged. The return tuple
    intentionally exposes counts and key names only.

    Returns (added_count, preserved_count, removed_keys).
    """
    existing: dict[str, str] = {}
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            stripped = raw.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            existing[key.strip()] = value.strip()

    registry_keys = {name.upper() for name in Settings.model_fields}
    added = 0
    preserved = 0
    removed = sorted(set(existing) - registry_keys)

    new_lines: list[str] = []
    for name, info in Settings.model_fields.items():
        env_name = name.upper()
        if env_name in existing:
            preserved += 1
            value = existing[env_name]
        else:
            added += 1
            default: Any = info.default
            if default is PydanticUndefined or default is None or isinstance(default, SecretStr):
                value = ""
            elif isinstance(default, bool):
                value = "true" if default else "false"
            else:
                value = str(default)
        if info.description:
            new_lines.append(f"# {info.description.strip()}")
        new_lines.append(f"{env_name}={value}")
        new_lines.append("")

    env_path.write_text("\n".join(new_lines).rstrip() + "\n", encoding="utf-8")
    return added, preserved, removed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate or overlay .env from the typed registry.")
    parser.add_argument(
        "--overlay",
        type=Path,
        help="Idempotently add missing keys to the given .env file; preserve existing values.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(".env.example"),
        help="Output path for the generated example (default: .env.example).",
    )
    args = parser.parse_args(argv)

    if args.overlay:
        added, preserved, removed = overlay_into(args.overlay)
        print(f"overlay: added {added}, preserved {preserved}")
        if removed:
            print(f"warning: keys present in {args.overlay} but not in registry: {', '.join(removed)}")
            print("        review and remove manually if intentional.")
        return 0

    args.out.write_text(render_example(), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
