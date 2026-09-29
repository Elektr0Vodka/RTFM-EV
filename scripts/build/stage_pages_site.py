#!/usr/bin/env python3
"""Stage the GitHub Pages documentation site into a directory for Jekyll.

Sources (single source of truth, nothing generated is committed):
  README.md, README_ADVANCED.md, README_HA.md   -> /, /advanced/, /home-assistant/
  frontend/src/content/manual/<lang>.md         -> /guide/<lang>/ (+ /guide/ chooser)
  pages/                                        -> site shell (layout, CSS, JS, _config.yml)

Only the files above are published. Everything else in the repo (docs/, AGENTS.md,
CONTRIBUTING.md, ...) is linked on GitHub instead of copied. Images a page links
with a relative path are copied next to it.

What the staging does to the markdown:
  - adds Jekyll front matter (title, language, table of contents, nav state)
  - gives every heading an explicit id: the guide's `<!-- id: x -->` marker for
    `##` sections (the same ids the app uses), otherwise the GitHub-style slug,
    so README anchor links keep working
  - rewrites relative links: README*.md to their site pages, images to copied
    files, anything else to https://github.com/<repo>/blob|tree/<ref>/<path>
  - wraps each page in {% raw %} so Liquid-looking text (Home Assistant
    templates) is shown as written

Standard library only. Used by .github/workflows/pages.yml; runs locally too:
  python3 scripts/build/stage_pages_site.py --out _pages_build/src
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SHELL_DIR = REPO_ROOT / "pages"
MANUAL_DIR = "frontend/src/content/manual"
LOCALES_DIR = REPO_ROOT / "frontend" / "src" / "i18n" / "locales"
STAGING_MARKER = ".pages-staging"
DEFAULT_REPO_URL = "https://github.com/Elektr0Vodka/RTFM-EV"
DEFAULT_REF = "main"

# Repo markdown file -> (site directory, nav key). README.md is the landing page.
DOC_PAGES = {
    "README.md": ("", "home"),
    "README_ADVANCED.md": ("advanced/", "advanced"),
    "README_HA.md": ("home-assistant/", "ha"),
}

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}

ID_MARKER = re.compile(r"^\s*<!--\s*id:\s*([a-z0-9-]+)\s*-->\s*$")
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
ATX = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$")
EXPLICIT_ID = re.compile(r"[ \t]+\{#([^}\s]+)\}$")
# kramdown only honours `{#id}` when the id matches this; other ids use an HTML heading.
KRAMDOWN_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_:-]*$")
INLINE_CODE = re.compile(r"(`+)(?:.+?)\1")
INLINE_LINK = re.compile(
    r"(!?)\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(<[^>]*>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(\s+\"[^\"]*\")?\s*\)"
)
REF_DEF = re.compile(r"^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>]*>|\S+)(.*)$")
HTML_ATTR = re.compile(r"(\s(?:src|href)=)([\"'])(.*?)\2")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def warn(msg: str) -> None:
    print(f"warning: {msg}", file=sys.stderr)


def plain_text(md: str) -> str:
    """Rendered text of a heading, close enough to GitHub for slugs and the TOC."""
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", md)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("`", "").replace("**", "")
    text = re.sub(r"(?<!\w)\*(\S[^*]*)\*(?!\w)", r"\1", text)
    return text.strip()


def github_slug(text: str) -> str:
    """GitHub heading anchor (github-slugger): lowercase, drop punctuation, spaces to '-'."""
    return re.sub(r"[^\w\- ]", "", text.lower()).replace(" ", "-")


class Slugger:
    def __init__(self, reserved: set[str]) -> None:
        self.used = set(reserved)

    def unique(self, base: str) -> str:
        base = base or "section"
        slug, n = base, 0
        while slug in self.used:
            n += 1
            slug = f"{base}-{n}"
        self.used.add(slug)
        return slug


def html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )


class Stager:
    def __init__(self, out: Path, repo_url: str, ref: str) -> None:
        self.out = out
        self.repo_url = repo_url.rstrip("/")
        self.ref = ref
        self.assets: set[str] = set()
        self.pages: list[str] = []

    # ---- links -------------------------------------------------------------

    def github_url(self, repo_path: str, is_dir: bool) -> str:
        if repo_path in ("", "."):
            return self.repo_url
        kind = "tree" if is_dir else "blob"
        return f"{self.repo_url}/{kind}/{self.ref}/{repo_path.rstrip('/')}"

    def rewrite_target(self, target: str, src_rel: str, page_dir: str) -> str:
        wrapped = target.startswith("<") and target.endswith(">")
        raw = target[1:-1] if wrapped else target
        if not raw or raw.startswith(("#", "//")) or SCHEME.match(raw):
            return target
        path, sep, frag = raw.partition("#")
        path = path.split("?", 1)[0]
        repo_path = posixpath.normpath(posixpath.join(posixpath.dirname(src_rel), path))
        if repo_path == ".." or repo_path.startswith("../"):
            warn(f"{src_rel}: link {raw!r} points outside the repository; left unchanged")
            return target
        root = "../" * page_dir.count("/")
        fs_path = REPO_ROOT / repo_path
        if repo_path in DOC_PAGES:
            url = root + DOC_PAGES[repo_path][0]
            url = url or "./"
        elif posixpath.splitext(repo_path)[1].lower() in IMAGE_EXTS and fs_path.is_file():
            if repo_path not in self.assets:
                dest = self.out / repo_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(fs_path, dest)
                self.assets.add(repo_path)
            url = root + repo_path
        else:
            if not fs_path.exists():
                warn(f"{src_rel}: link target {repo_path!r} does not exist in the repository")
            url = self.github_url(repo_path, fs_path.is_dir() or path.endswith("/"))
        if sep:
            url += "#" + frag
        return f"<{url}>" if wrapped else url

    def rewrite_links(self, text: str, src_rel: str, page_dir: str) -> str:
        def inline(m: re.Match[str]) -> str:
            bang, label, target, title = m.group(1), m.group(2), m.group(3), m.group(4) or ""
            label = INLINE_LINK.sub(inline, label)  # e.g. a badge image inside a link
            return f"{bang}[{label}]({self.rewrite_target(target, src_rel, page_dir)}{title})"

        def attr(m: re.Match[str]) -> str:
            return f"{m.group(1)}{m.group(2)}{self.rewrite_target(m.group(3), src_rel, page_dir)}{m.group(2)}"

        ref = REF_DEF.match(text)
        if ref:
            return (
                ref.group(1) + self.rewrite_target(ref.group(2), src_rel, page_dir) + ref.group(3)
            )
        # Leave inline code spans alone.
        parts, last = [], 0
        for code in INLINE_CODE.finditer(text):
            chunk = text[last : code.start()]
            parts.append(HTML_ATTR.sub(attr, INLINE_LINK.sub(inline, chunk)))
            parts.append(code.group(0))
            last = code.end()
        parts.append(HTML_ATTR.sub(attr, INLINE_LINK.sub(inline, text[last:])))
        return "".join(parts)

    # ---- markdown ----------------------------------------------------------

    def convert(
        self, source: str, src_rel: str, page_dir: str
    ) -> tuple[str, str | None, list[dict]]:
        """Return (markdown, first h1 text, toc of ## headings)."""
        lines = source.splitlines()
        markers = {m.group(1) for line in lines if (m := ID_MARKER.match(line))}
        slugger = Slugger(markers)
        out: list[str] = []
        toc: list[dict] = []
        title: str | None = None
        fence: str | None = None
        pending_id: str | None = None

        for line in lines:
            fm = FENCE.match(line)
            if fence is not None:
                out.append(line)
                if (
                    fm
                    and fm.group(1)[0] == fence[0]
                    and len(fm.group(1)) >= len(fence)
                    and not line.strip()[len(fm.group(1)) :].strip()
                ):
                    fence = None
                continue
            if fm:
                fence = fm.group(1)
                out.append(line)
                continue

            marker = ID_MARKER.match(line)
            if marker:
                pending_id = marker.group(1)
                continue

            heading = ATX.match(line)
            if heading:
                level = len(heading.group(1))
                text = heading.group(2)
                explicit = EXPLICIT_ID.search(text)
                if explicit:
                    text = text[: explicit.start()]
                    slug = explicit.group(1)
                    slugger.used.add(slug)
                elif level == 2 and pending_id:
                    slug = pending_id
                else:
                    slug = slugger.unique(github_slug(plain_text(text)))
                if level == 2:
                    pending_id = None
                    toc.append({"id": slug, "title": plain_text(text)})
                if level == 1 and title is None:
                    title = plain_text(text)
                text = self.rewrite_links(text, src_rel, page_dir)
                if KRAMDOWN_ID.match(slug):
                    out.append(f"{'#' * level} {text} {{#{slug}}}")
                else:
                    out.extend(
                        [
                            "",
                            f'<h{level} id="{html_escape(slug)}" markdown="span">{text}</h{level}>',
                            "",
                        ]
                    )
                continue

            out.append(self.rewrite_links(line, src_rel, page_dir))

        if fence is not None:
            warn(f"{src_rel}: unclosed code fence")
        return "\n".join(out) + "\n", title, toc

    def write_page(self, page_dir: str, front: dict, body: str) -> None:
        dest = self.out / page_dir / "index.md"
        dest.parent.mkdir(parents=True, exist_ok=True)
        fm = "".join(
            f"{key}: {json.dumps(value, ensure_ascii=False)}\n" for key, value in front.items()
        )
        # Keep Liquid from interpreting `{{ ... }}` / `{% ... %}` in the docs.
        body = body.replace("{% endraw %}", "{% endraw %}{{ '{% endraw %}' }}{% raw %}")
        dest.write_text(f"---\n{fm}---\n{{% raw %}}\n{body}{{% endraw %}}\n", encoding="utf-8")
        self.pages.append(page_dir + "index.md")

    @staticmethod
    def root_of(page_dir: str) -> str:
        return "../" * page_dir.count("/") or "./"

    # ---- pages -------------------------------------------------------------

    def stage_doc(self, src_rel: str, guide_label: str) -> None:
        src = REPO_ROOT / src_rel
        if not src.is_file():
            warn(f"{src_rel} not found; page skipped")
            return
        page_dir, nav = DOC_PAGES[src_rel]
        body, title, toc = self.convert(src.read_text(encoding="utf-8"), src_rel, page_dir)
        front = {
            "title": title or src_rel,
            "lang": "en",
            "root": self.root_of(page_dir),
            "nav": nav,
            "guide_label": guide_label,
            "source_url": self.github_url(src_rel, False),
        }
        if len(toc) > 1:
            front["toc"] = toc
        self.write_page(page_dir, front, body)

    def stage_guide(self, langs: list[dict]) -> None:
        for lang in langs:
            src_rel = f"{MANUAL_DIR}/{lang['code']}.md"
            page_dir = f"guide/{lang['code']}/"
            source = (REPO_ROOT / src_rel).read_text(encoding="utf-8")
            body, _title, toc = self.convert(
                f"# {lang['guide_label']}\n\n{source}", src_rel, page_dir
            )
            front = {
                "title": lang["guide_label"],
                "lang": lang["code"],
                "root": self.root_of(page_dir),
                "nav": "guide",
                "guide_label": lang["guide_label"],
                "toc_heading": lang["contents_heading"],
                "toc": toc,
                "languages": [
                    {
                        "code": other["code"],
                        "name": other["name"],
                        "url": f"../{other['code']}/",
                        "current": other["code"] == lang["code"],
                    }
                    for other in langs
                ],
                "source_url": self.github_url(src_rel, False),
            }
            self.write_page(page_dir, front, body)

        # /guide/ itself: a plain language chooser so the directory URL does not 404.
        items = "\n".join(
            f"- [{lang['guide_label']} ({lang['name']})]({lang['code']}/)" for lang in langs
        )
        front = {
            "title": langs[0]["guide_label"],
            "lang": "en",
            "root": "../",
            "nav": "guide",
            "guide_label": langs[0]["guide_label"],
        }
        self.write_page("guide/", front, f"# {langs[0]['guide_label']}\n\n{items}\n")


def guide_languages() -> list[dict]:
    """Manual languages present in the repo (EN, NL, DE, then any others), labels from the app's locale catalogs."""
    present = {p.stem for p in (REPO_ROOT / MANUAL_DIR).glob("*.md")}
    preferred = [code for code in ("en", "nl", "de") if code in present]
    codes = preferred + sorted(present - set(preferred))
    if not codes:
        sys.exit(f"error: no manual files in {MANUAL_DIR}")

    def catalog(code: str) -> dict:
        path = LOCALES_DIR / f"{code}.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}

    en = catalog("en")
    langs = []
    for code in codes:
        cat = catalog(code)
        langs.append(
            {
                "code": code,
                "name": cat.get("_meta", {}).get("name", code),
                "guide_label": cat.get("nav_user_guide") or en.get("nav_user_guide", "User Guide"),
                "contents_heading": cat.get("manual_contents_heading")
                or en.get("manual_contents_heading", "Contents"),
            }
        )
    return langs


def prepare_out(out: Path) -> None:
    if out == REPO_ROOT or out in REPO_ROOT.parents:
        sys.exit(f"error: refusing to stage into {out}")
    if out.exists():
        if any(out.iterdir()) and not (out / STAGING_MARKER).exists():
            sys.exit(f"error: {out} is not empty and was not created by this script")
        shutil.rmtree(out)
    shutil.copytree(SHELL_DIR, out)
    (out / STAGING_MARKER).write_text(
        "Generated by scripts/build/stage_pages_site.py; safe to delete.\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--out", required=True, help="staging directory (replaced if it was staged before)"
    )
    parser.add_argument(
        "--repo-url",
        default=DEFAULT_REPO_URL,
        help=f"base for GitHub links (default {DEFAULT_REPO_URL})",
    )
    parser.add_argument(
        "--ref", default=DEFAULT_REF, help=f"branch used in GitHub links (default {DEFAULT_REF})"
    )
    args = parser.parse_args()

    out = Path(args.out).resolve()
    prepare_out(out)
    stager = Stager(out, args.repo_url, args.ref)
    langs = guide_languages()
    for src_rel in DOC_PAGES:
        stager.stage_doc(src_rel, langs[0]["guide_label"])
    stager.stage_guide(langs)

    print(f"Staged {len(stager.pages)} pages into {out}")
    for page in stager.pages:
        print(f"  {page}")
    for asset in sorted(stager.assets):
        print(f"  {asset} (asset)")


if __name__ == "__main__":
    main()
