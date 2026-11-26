#!/usr/bin/env python3
"""Zero-dependency secret & forbidden-file guard for Discogs Sniper.

Used by:
  - `.githooks/pre-commit` (`--staged`)
  - `.githooks/pre-push` (`--push`)
  - `.github/workflows/static.yml` (`--repo`)
  - `tests/test_sniper_v2.py`
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import fnmatch
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys

REPO_ROOT = Path(__file__).resolve().parent.parent

ALLOWED_ENV_TEMPLATES = {
    ".env.example",
    ".env.sample",
    ".env.template",
}

FORBIDDEN_DIR_PREFIXES = (
    "chrome_discogs_profile/",
)

FORBIDDEN_EXACT_NAMES = {
    "sniper.log",
    "sniper.lock",
    "credentials.json",
    "token.json",
}

FORBIDDEN_GLOBS = (
    "debug_*.html",
    "debug_*.png",
    "*.cookie_bak",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "*.jks",
)

ALLOW_MARKER = "secret-guard: allow"

PLACEHOLDER_SUBSTRINGS = (
    "your_",
    "example",
    "placeholder",
    "changeme",
    "replace_me",
    "redacted",
    "dummy",
    "fake",
    "xxxx",
    "testtoken",
    "validtest",
    "secrettokenvalue",
    "11abcdef",
)

SECRET_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "hardcoded_gmail_app_password_default",
        re.compile(
            r"""(?:get_var\s*\(\s*\(\s*["']GMAIL_APP_PASSWORD["']\s*,?\s*\)\s*,|os\.getenv\s*\(\s*["']GMAIL_APP_PASSWORD["']\s*,)\s*["']([A-Za-z0-9 ]{8,})["']""",
            re.IGNORECASE,
        ),
    ),
    (
        "gmail_app_password_assignment",
        re.compile(
            r"""(?:^|[\s,(])GMAIL_APP_PASSWORD\s*[:=]\s*["']?([A-Za-z0-9]{12,}|(?:[A-Za-z0-9]{4}\s+){3}[A-Za-z0-9]{4})["']?""",
            re.IGNORECASE,
        ),
    ),
    (
        "discogs_token_assignment",
        re.compile(
            r"""(?:^|[\s,(])(?:DISCOGS_TOKEN|DISCOGS_API_TOKEN|DISCOGS_PERSONAL_ACCESS_TOKEN|DISCOGS_ACCESS_TOKEN|DISCOGS_PAT)\s*[:=]\s*["']?([A-Za-z0-9._-]{20,})["']?""",
            re.IGNORECASE,
        ),
    ),
    (
        "discogs_auth_header",
        re.compile(r"""Discogs\s+token=([A-Za-z0-9._-]{20,})""", re.IGNORECASE),
    ),
    (
        "github_pat",
        re.compile(r"""\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,})\b"""),
    ),
    (
        "google_api_key",
        re.compile(r"""\b(AIza[0-9A-Za-z_-]{35})\b"""),
    ),
    (
        "aws_access_key",
        re.compile(r"""\b(AKIA[0-9A-Z]{16})\b"""),
    ),
    (
        "openai_or_stripe_key",
        re.compile(r"""\b(sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{24,})\b"""),
    ),
    (
        "slack_token",
        re.compile(r"""\b(xox[baprs]-[A-Za-z0-9-]{12,})\b"""),
    ),
    (
        "private_key_block",
        re.compile(r"""(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----)"""),
    ),
)

BINARY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".webp",
    ".woff",
    ".woff2",
    ".ttf",
    ".zip",
    ".gz",
    ".pdf",
}


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    rule: str
    detail: str


def normalize_relpath(path: str) -> str:
    norm = path.replace("\\", "/")
    while norm.startswith("./"):
        norm = norm[2:]
    return norm.lstrip("/")


def is_forbidden_path(path: str) -> str | None:
    norm = normalize_relpath(path)
    low = norm.lower()
    name = PurePosixPath(norm).name.lower()

    if name not in ALLOWED_ENV_TEMPLATES:
        if name == ".env" or name.startswith(".env.") or name.endswith(".env"):
            return "forbidden_env_file"

    for prefix in FORBIDDEN_DIR_PREFIXES:
        if low.startswith(prefix) or f"/{prefix}" in low:
            return "forbidden_browser_profile"

    if name in FORBIDDEN_EXACT_NAMES:
        return "forbidden_runtime_or_credential_file"

    for pat in FORBIDDEN_GLOBS:
        if fnmatch.fnmatch(name, pat):
            return f"forbidden_file_pattern({pat})"

    return None


def _is_placeholder(value: str) -> bool:
    v = value.strip().strip("\"'`")
    if not v or v.startswith(("$", "${", "%", "<")):
        return True
    low = v.lower()
    if any(tok in low for tok in PLACEHOLDER_SUBSTRINGS):
        return True
    # Repeated single char or trivial sequence (e.g. aaaaaaaa)
    if len(set(low.replace(" ", ""))) <= 2:
        return True
    return False


def _redact(value: str) -> str:
    v = value.strip()
    if len(v) <= 6:
        return "<REDACTED>"
    return f"{v[:3]}...<REDACTED len={len(v)}>"


def scan_text(path: str, text: str) -> list[Finding]:
    findings: list[Finding] = []
    norm = normalize_relpath(path)
    if PurePosixPath(norm).suffix.lower() in BINARY_EXTENSIONS:
        return findings

    for lineno, line in enumerate(text.splitlines(), 1):
        if ALLOW_MARKER in line:
            continue
        for rule_name, pattern in SECRET_RULES:
            for match in pattern.finditer(line):
                captured = match.group(1) if match.lastindex else match.group(0)
                if rule_name != "private_key_block" and _is_placeholder(captured):
                    continue
                findings.append(
                    Finding(
                        path=norm,
                        line=lineno,
                        rule=rule_name,
                        detail=_redact(captured),
                    )
                )
    return findings


def _git(repo_root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", "-C", str(repo_root), *args],
        capture_output=True,
        check=False,
    )


def scan_staged(repo_root: Path = REPO_ROOT) -> list[Finding]:
    findings: list[Finding] = []
    res = _git(repo_root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    if res.returncode != 0:
        return findings
    paths = [p for p in res.stdout.decode("utf-8", errors="replace").split("\0") if p]
    for rel in paths:
        reason = is_forbidden_path(rel)
        if reason:
            findings.append(Finding(path=normalize_relpath(rel), line=0, rule=reason, detail="blocked path"))
            continue
        blob = _git(repo_root, "show", f":{rel}")
        if blob.returncode == 0 and b"\x00" not in blob.stdout[:4096]:
            findings.extend(scan_text(rel, blob.stdout.decode("utf-8", errors="replace")))
    return findings


def scan_repo_tracked(repo_root: Path = REPO_ROOT) -> list[Finding]:
    findings: list[Finding] = []
    res = _git(repo_root, "ls-files", "-z")
    if res.returncode != 0:
        return findings
    paths = [p for p in res.stdout.decode("utf-8", errors="replace").split("\0") if p]
    for rel in paths:
        reason = is_forbidden_path(rel)
        if reason:
            findings.append(Finding(path=normalize_relpath(rel), line=0, rule=reason, detail="tracked forbidden path"))
            continue
        full = repo_root / rel
        if not full.is_file():
            continue
        raw = full.read_bytes()
        if b"\x00" in raw[:4096]:
            continue
        findings.extend(scan_text(rel, raw.decode("utf-8", errors="replace")))
    return findings


def scan_unpushed_commits(repo_root: Path = REPO_ROOT) -> list[Finding]:
    findings = scan_repo_tracked(repo_root)
    # Also scan every file touched in local unpushed commits so an earlier unpushed commit cannot hide a secret
    rev_range = "@{u}..HEAD"
    chk = _git(repo_root, "rev-parse", "--verify", "@{u}")
    if chk.returncode != 0:
        rev_range = "HEAD"
    commits_res = _git(repo_root, "rev-list", rev_range)
    if commits_res.returncode != 0:
        return findings
    commits = [c.strip() for c in commits_res.stdout.decode("utf-8", errors="replace").splitlines() if c.strip()]
    seen: set[tuple[str, str]] = set()
    for commit in commits:
        tree_res = _git(repo_root, "diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=ACMR", "-z", commit)
        if tree_res.returncode != 0:
            continue
        for rel in (p for p in tree_res.stdout.decode("utf-8", errors="replace").split("\0") if p):
            reason = is_forbidden_path(rel)
            if reason:
                findings.append(
                    Finding(
                        path=f"{commit[:7]}:{normalize_relpath(rel)}",
                        line=0,
                        rule=reason,
                        detail="forbidden path in unpushed commit",
                    )
                )
                continue
            blob_id_res = _git(repo_root, "rev-parse", f"{commit}:{rel}")
            if blob_id_res.returncode != 0:
                continue
            blob_id = blob_id_res.stdout.decode("utf-8", errors="replace").strip()
            key = (blob_id, rel)
            if key in seen:
                continue
            seen.add(key)
            blob = _git(repo_root, "cat-file", "blob", blob_id)
            if blob.returncode == 0 and b"\x00" not in blob.stdout[:4096]:
                for fnd in scan_text(rel, blob.stdout.decode("utf-8", errors="replace")):
                    findings.append(
                        Finding(
                            path=f"{commit[:7]}:{fnd.path}",
                            line=fnd.line,
                            rule=fnd.rule,
                            detail=fnd.detail,
                        )
                    )
    # Deduplicate while preserving order
    return list(dict.fromkeys(findings))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Discogs Sniper Secret & Forbidden-File Guard")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--staged", action="store_true", help="Scan staged files (pre-commit hook)")
    mode.add_argument("--push", action="store_true", help="Scan tracked files & unpushed commits (pre-push hook)")
    mode.add_argument("--repo", action="store_true", help="Scan all git-tracked files (CI check)")
    args = parser.parse_args(argv)

    if args.staged:
        findings = scan_staged(REPO_ROOT)
        scope = "staged changes"
    elif args.push:
        findings = scan_unpushed_commits(REPO_ROOT)
        scope = "push targets"
    else:
        findings = scan_repo_tracked(REPO_ROOT)
        scope = "tracked repository files"

    if findings:
        print(f"[SECRET-GUARD BLOCKED] Found {len(findings)} security violation(s) in {scope}:", file=sys.stderr)
        for f in findings:
            loc = f"{f.path}:{f.line}" if f.line else f.path
            print(f"  - {loc} [{f.rule}] ({f.detail})", file=sys.stderr)
        print(
            "\nFix: remove secrets/forbidden files from staging/history, store local secrets ONLY in untracked `.env`, "
            "and never commit `.env` or `chrome_discogs_profile/`.",
            file=sys.stderr,
        )
        return 1

    print(f"[secret-guard] OK: 0 secret or forbidden-file violations in {scope}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
