#!/usr/bin/env python3
"""Parse Martin metrics from dependency-cruiser JSON.

Reports per-folder and per-module Ca (afferent), Ce (efferent),
I = Ce / (Ca + Ce) instability, and totals — scoped to ws_apps code
(node_modules and bare core-module references filtered out).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
with open(HERE / "depcruise.json", encoding="utf-8") as _f:
    RAW = json.load(_f)


def is_workspace(name: str) -> bool:
    if not name:
        return False
    if name.startswith("node_modules") or "/" not in name and "." not in name:
        # bare names like '@opentelemetry', 'path', 'url', 'child_process'
        return False
    return name.startswith("ws_apps") or name.startswith("ws_packages")


def fmt_i(i):
    return "—" if i is None else f"{i:.3f}"


folders = [f for f in RAW.get("folders", []) if is_workspace(f["name"])]
modules = [m for m in RAW.get("modules", []) if is_workspace(m["source"])]

print(f"# Dependency-cruiser 17.4.0 — Martin metrics (workspace scope)\n")
print(f"Total readings: folders={len(folders)} modules={len(modules)} "
      f"(raw cruise totals: {RAW['summary']['totalCruised']} modules, "
      f"{RAW['summary']['totalDependenciesCruised']} deps)\n")

print("## Per-folder (Robert C. Martin package metrics)\n")
print(f"{'folder':<48} {'mods':>4} {'Ca':>4} {'Ce':>4} {'I':>6}")
print("-" * 70)
for f in sorted(folders, key=lambda x: x["name"]):
    print(f"{f['name']:<48} {f['moduleCount']:>4} "
          f"{f['afferentCouplings']:>4} {f['efferentCouplings']:>4} "
          f"{fmt_i(f.get('instability')):>6}")

print("\n## Per-module\n")
print(f"{'module':<60} {'Ca':>4} {'Ce':>4} {'I':>6}")
print("-" * 80)
for m in sorted(modules, key=lambda x: x["source"]):
    ca = len(m.get("dependents", []))
    ce = len(m.get("dependencies", []))
    print(f"{m['source']:<60} {ca:>4} {ce:>4} {fmt_i(m.get('instability')):>6}")

# Distribution stats
ws_i = [m["instability"] for m in modules if m.get("instability") is not None]
folder_i = [f["instability"] for f in folders if f.get("instability") is not None]

print("\n## Distribution\n")
print(f"Workspace modules with I defined: {len(ws_i)}")
if ws_i:
    print(f"  min/median/max I: {min(ws_i):.3f} / "
          f"{sorted(ws_i)[len(ws_i)//2]:.3f} / {max(ws_i):.3f}")
    stable = sum(1 for i in ws_i if i <= 0.2)
    unstable = sum(1 for i in ws_i if i >= 0.8)
    print(f"  stable (I<=0.2): {stable}   unstable (I>=0.8): {unstable}")

print(f"\nFolders with I defined: {len(folder_i)}")
if folder_i:
    print(f"  min/median/max I: {min(folder_i):.3f} / "
          f"{sorted(folder_i)[len(folder_i)//2]:.3f} / {max(folder_i):.3f}")
