#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Update fnpack.json according to Schema Version 2 specification.
"""

import os
import sys
import json
import re
import argparse


def read_text_file(filepath):
    """Safely read text file with fallback encodings."""
    if not os.path.exists(filepath):
        return ""
    for enc in ["utf-8-sig", "utf-8", "gbk", "gb18030"]:
        try:
            with open(filepath, "r", encoding=enc) as f:
                return f.read()
        except UnicodeDecodeError:
            continue
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def parse_kv_file(filepath):
    """Parse key = value config files like manifest and i18n files."""
    data = {}
    content = read_text_file(filepath)
    if not content:
        return data
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k = k.strip()
        v = v.strip().strip('"\'')
        data[k] = v
    return data


def find_source_dir(appname, search_base="."):
    """Find source directory matching appname."""
    direct_path = os.path.join(search_base, f"fn-{appname}")
    if os.path.isdir(direct_path):
        return direct_path

    for entry in os.listdir(search_base):
        entry_path = os.path.join(search_base, entry)
        if os.path.isdir(entry_path) and entry.startswith("fn-"):
            manifest_path = os.path.join(entry_path, "manifest")
            if os.path.isfile(manifest_path):
                m = parse_kv_file(manifest_path)
                if m.get("appname") == appname:
                    return entry_path
    return direct_path


def update_app_entry(fnpack_path, repo, tag, fpk_file, source_dir=None, search_base="."):
    """Update single app entry in fnpack.json."""
    if not os.path.exists(fpk_file):
        print(f"Warning: FPK file not found: {fpk_file}")
        return

    basename = os.path.splitext(os.path.basename(fpk_file))[0]
    appname = basename
    version = ""

    # Match naming: appname_v1.0.0 or appname-v1.0.0
    m_match = re.match(r"^(.+)[-_]v?([0-9]+\.[0-9]+.*)$", basename)
    if m_match:
        appname = m_match.group(1)
        version = m_match.group(2)

    if not source_dir or not os.path.isdir(source_dir):
        source_dir = find_source_dir(appname, search_base)

    manifest = {}
    if os.path.isdir(source_dir):
        manifest = parse_kv_file(os.path.join(source_dir, "manifest"))

    appname = manifest.get("appname", appname)
    if not version:
        version = manifest.get("version", "1.0.0")

    display_name = manifest.get("display_name", appname)
    desc = manifest.get("desc", "")

    # i18n overrides
    if os.path.isdir(source_dir):
        for lang in ["zh-CN", "en-US"]:
            i18n_path = os.path.join(source_dir, "i18n", lang)
            if os.path.exists(i18n_path):
                i18n = parse_kv_file(i18n_path)
                i18n_name = i18n.get("displayName") or i18n.get("display_name")
                if i18n_name:
                    display_name = i18n_name
                i18n_desc = i18n.get("desc")
                if i18n_desc:
                    desc = i18n_desc
                break

    platform_raw = manifest.get("platform", "x86")
    platform_list = [p.strip() for p in re.split(r'[,，、|/ \s]+', platform_raw) if p.strip()]
    if not platform_list:
        platform_list = ["x86"]

    categories = []
    if os.path.isdir(source_dir):
        labels_path = os.path.join(source_dir, "labels.txt")
        if os.path.exists(labels_path):
            labels_content = read_text_file(labels_path).strip()
            if labels_content:
                categories = [c.strip() for c in re.split(r'[,，、|/ \s\n\r]+', labels_content) if c.strip()]

    maintainer = manifest.get("maintainer")
    maintainer_url = manifest.get("maintainer_url")
    distributor = manifest.get("distributor")
    distributor_url = manifest.get("distributor_url")
    install_type_raw = manifest.get("install_type", "")
    install_type = "root" if install_type_raw == "root" else ""

    size_bytes = os.path.getsize(fpk_file)

    # Load existing fnpack.json
    if os.path.exists(fnpack_path):
        content = read_text_file(fnpack_path)
        try:
            data = json.loads(content) if content else {}
        except Exception as e:
            print(f"Warning: Failed to parse {fnpack_path}: {e}")
            data = {}
    else:
        data = {}

    data.setdefault("schema_version", "2")
    data.setdefault("source_info", {
        "name": "Giraff 飞牛应用源",
        "author": "Giraff",
        "homepage": "https://github.com/Brian099/FnDepot",
        "description": "专为飞牛 NAS (fnOS) 打造的第三方精选应用源。"
    })
    apps = data.setdefault("apps", {})

    app_entry = apps.setdefault(appname, {})

    # Update metadata
    if display_name:
        app_entry["display_name"] = display_name
    elif "display_name" not in app_entry:
        app_entry["display_name"] = appname

    if desc:
        app_entry["desc"] = desc
    elif "desc" not in app_entry:
        app_entry["desc"] = ""

    app_entry["platform"] = platform_list

    if categories:
        app_entry["categories"] = categories
    elif "categories" not in app_entry:
        app_entry["categories"] = ["系统工具"]

    if os.path.isdir(source_dir) and os.path.exists(os.path.join(source_dir, "README.md")):
        app_entry.setdefault("readme_url", f"{appname}/README.md")

    app_entry.setdefault("bug_report_url", f"https://github.com/{repo}/issues")

    if maintainer:
        app_entry["maintainer"] = maintainer
    elif "maintainer" not in app_entry:
        app_entry["maintainer"] = "Giraff"

    if maintainer_url:
        app_entry["maintainer_url"] = maintainer_url

    if distributor:
        app_entry["distributor"] = distributor

    if distributor_url:
        app_entry["distributor_url"] = distributor_url

    if "run_as" not in app_entry:
        app_entry["run_as"] = "root" if install_type == "root" else "package"

    app_entry["install_type"] = install_type
    app_entry.setdefault("is_docker", False)

    # Update releases
    releases = app_entry.setdefault("releases", {})
    ver_entry = releases.setdefault(version, {})
    packages = ver_entry.setdefault("packages", {})

    arch_key = platform_list[0] if platform_list else "x86"
    download_url = f"https://github.com/{repo}/releases/download/{tag}/{basename}.fpk"

    packages[arch_key] = {
        "download_url": download_url,
        "size": size_bytes
    }

    # Save to file
    with open(fnpack_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Successfully updated fnpack.json for app: {appname} (version: {version}, arch: {arch_key}, size: {size_bytes} bytes)")


def main():
    parser = argparse.ArgumentParser(description="Update fnpack.json with built fpk files.")
    parser.add_argument("--fnpack", required=True, help="Path to fnpack.json")
    parser.add_argument("--repo", required=True, help="GitHub repository (owner/repo)")
    parser.add_argument("--tag", required=True, help="Release tag")
    parser.add_argument("--fpk", help="Path to a single fpk file")
    parser.add_argument("--source-dir", help="Path to the app source directory")
    parser.add_argument("--search-base", default=".", help="Base directory to search for app source dirs")

    args = parser.parse_args()

    if args.fpk:
        update_app_entry(
            fnpack_path=args.fnpack,
            repo=args.repo,
            tag=args.tag,
            fpk_file=args.fpk,
            source_dir=args.source_dir,
            search_base=args.search_base
        )
    else:
        print("Error: --fpk is required")
        sys.exit(1)


if __name__ == "__main__":
    main()
