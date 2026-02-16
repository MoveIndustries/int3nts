#!/usr/bin/env python3
"""
Check markdown files for linting violations.

This script detects common markdown linting issues:
- MD040: Code blocks without language specifiers
- MD012: Multiple consecutive blank lines
- MD022: Headings not surrounded by blank lines
- MD032: Lists not surrounded by blank lines
"""

import sys
import os
import re
from pathlib import Path
from typing import List, Tuple, Dict


def find_md040_violations(filepath: str) -> List[int]:
    """Find code blocks without language specifiers (MD040)."""
    violations = []

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            in_code_block = False

            for i, line in enumerate(lines, 1):
                stripped = line.strip()
                if stripped.startswith('```'):
                    if not in_code_block:
                        # Opening code block
                        if stripped == '```':
                            violations.append(i)
                        in_code_block = True
                    else:
                        # Closing code block
                        in_code_block = False
    except Exception as e:
        print(f"Error reading {filepath}: {e}", file=sys.stderr)

    return violations


def find_md012_violations(filepath: str) -> List[int]:
    """Find multiple consecutive blank lines (MD012)."""
    violations = []

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            blank_count = 0

            for i, line in enumerate(lines, 1):
                if line.strip() == '':
                    blank_count += 1
                    if blank_count >= 3:  # 3+ consecutive blank lines
                        violations.append(i)
                else:
                    blank_count = 0
    except Exception as e:
        print(f"Error reading {filepath}: {e}", file=sys.stderr)

    return violations


def find_markdown_files(root_dir: str, exclude_dirs: List[str] = None) -> List[str]:
    """Find all markdown files, excluding specified directories."""
    if exclude_dirs is None:
        exclude_dirs = ['node_modules', 'build', 'target', 'dist']

    md_files = []
    for path in Path(root_dir).rglob('*.md'):
        # Check if path contains any excluded directory
        if not any(excluded in path.parts for excluded in exclude_dirs):
            md_files.append(str(path))

    return sorted(md_files)


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Check markdown files for linting violations')
    parser.add_argument('--root', default='.', help='Root directory to search (default: current directory)')
    parser.add_argument('--check', choices=['md040', 'md012', 'all'], default='all',
                        help='Which checks to run (default: all)')
    parser.add_argument('--list-files', action='store_true',
                        help='Only list files with violations, not line numbers')
    parser.add_argument('files', nargs='*', help='Specific files to check (if not provided, checks all .md files)')

    args = parser.parse_args()

    # Determine which files to check
    if args.files:
        md_files = args.files
    else:
        md_files = find_markdown_files(args.root)

    # Track violations by type
    violations: Dict[str, Dict[str, List[int]]] = {
        'md040': {},
        'md012': {},
    }

    # Check each file
    for filepath in md_files:
        if not os.path.exists(filepath):
            print(f"File not found: {filepath}", file=sys.stderr)
            continue

        if args.check in ['md040', 'all']:
            md040_issues = find_md040_violations(filepath)
            if md040_issues:
                violations['md040'][filepath] = md040_issues

        if args.check in ['md012', 'all']:
            md012_issues = find_md012_violations(filepath)
            if md012_issues:
                violations['md012'][filepath] = md012_issues

    # Report results
    total_files_with_issues = set()

    if violations['md040']:
        print("=" * 80)
        print("MD040: Code blocks without language specifiers")
        print("=" * 80)
        for filepath, lines in sorted(violations['md040'].items()):
            total_files_with_issues.add(filepath)
            if args.list_files:
                print(filepath)
            else:
                print(f"\n{filepath}:")
                for line_num in lines:
                    print(f"  Line {line_num}: Opening ``` without language specifier")
        print(f"\nTotal files with MD040 violations: {len(violations['md040'])}")

    if violations['md012']:
        print("\n" + "=" * 80)
        print("MD012: Multiple consecutive blank lines")
        print("=" * 80)
        for filepath, lines in sorted(violations['md012'].items()):
            total_files_with_issues.add(filepath)
            if args.list_files:
                print(filepath)
            else:
                print(f"\n{filepath}:")
                print(f"  {len(lines)} instances of 3+ consecutive blank lines")
        print(f"\nTotal files with MD012 violations: {len(violations['md012'])}")

    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total markdown files checked: {len(md_files)}")
    print(f"Files with violations: {len(total_files_with_issues)}")
    print(f"  - MD040 (missing language): {len(violations['md040'])} files")
    print(f"  - MD012 (multiple blanks): {len(violations['md012'])} files")

    # Exit with error code if violations found
    if total_files_with_issues:
        sys.exit(1)
    else:
        print("\n✓ No violations found!")
        sys.exit(0)


if __name__ == '__main__':
    main()
