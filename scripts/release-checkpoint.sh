#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/release-checkpoint.sh -m "提交信息" [options]

Options:
  -m, --message TEXT      有未提交改动时使用的提交信息
  -r, --remote NAME       推送远端，默认 origin
  -b, --branch NAME       推送分支，默认当前分支
  -t, --tag TAG           指定发布 tag，默认 vYYYY.MM.DD.N 自动递增
      --skip-tests        跳过测试命令
      --no-commit         不自动提交，要求工作区必须干净
  -h, --help              显示帮助

Environment:
  RELEASE_TEST_CMD        默认: go test ./model ./service ./relay/channel/codex ./controller

What it does:
  1. 检查工作区和当前分支
  2. 有改动时自动 git add -A 并提交
  3. 运行 git diff --check 和测试命令
  4. 推送分支
  5. 创建并推送 v* tag，触发 GitHub Release / Docker 构建
  6. 尝试输出 GitHub Actions 链接
EOF
}

remote="origin"
branch=""
message=""
tag=""
skip_tests=0
auto_commit=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    -m|--message)
      message="${2:-}"
      shift 2
      ;;
    -r|--remote)
      remote="${2:-}"
      shift 2
      ;;
    -b|--branch)
      branch="${2:-}"
      shift 2
      ;;
    -t|--tag)
      tag="${2:-}"
      shift 2
      ;;
    --skip-tests)
      skip_tests=1
      shift
      ;;
    --no-commit)
      auto_commit=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -z "$branch" ]]; then
  branch="$(git branch --show-current)"
fi
if [[ -z "$branch" ]]; then
  echo "Cannot determine current branch; pass --branch." >&2
  exit 1
fi

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  echo "Remote not found: $remote" >&2
  exit 1
fi

dirty=0
if [[ -n "$(git status --porcelain)" ]]; then
  dirty=1
fi

if [[ "$dirty" -eq 1 && "$auto_commit" -eq 0 ]]; then
  echo "Working tree is dirty and --no-commit was set." >&2
  git status --short
  exit 1
fi

if [[ "$dirty" -eq 1 ]]; then
  if [[ -z "$message" ]]; then
    echo "Commit message is required when working tree has changes. Use -m." >&2
    git status --short
    exit 1
  fi
  echo "==> Committing changes"
  git status --short
  git add -A
  git commit -m "$message"
else
  echo "==> Working tree clean; releasing HEAD"
fi

echo "==> Running whitespace check"
git diff --check

if [[ "$skip_tests" -eq 0 ]]; then
  test_cmd="${RELEASE_TEST_CMD:-go test ./model ./service ./relay/channel/codex ./controller}"
  echo "==> Running tests: $test_cmd"
  bash -lc "$test_cmd"
else
  echo "==> Tests skipped"
fi

echo "==> Fetching tags"
git fetch "$remote" --tags --quiet

if [[ -z "$tag" ]]; then
  today="$(date +'%Y.%m.%d')"
  prefix="v${today}."
  last="$(
    git tag --list "${prefix}*" |
      sed -E "s/^${prefix//./\\.}([0-9]+)$/\\1/" |
      grep -E '^[0-9]+$' |
      sort -n |
      tail -1 || true
  )"
  next=1
  if [[ -n "$last" ]]; then
    next=$((last + 1))
  fi
  tag="${prefix}${next}"
fi

if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
  echo "Tag already exists locally: $tag" >&2
  exit 1
fi
if git ls-remote --exit-code --tags "$remote" "refs/tags/${tag}" >/dev/null 2>&1; then
  echo "Tag already exists remotely: $tag" >&2
  exit 1
fi

head_sha="$(git rev-parse --short HEAD)"
echo "==> Pushing branch ${branch} to ${remote}"
git push "$remote" "$branch"

echo "==> Creating tag ${tag} at ${head_sha}"
git tag -a "$tag" -m "发布 ${tag}"

echo "==> Pushing tag ${tag}"
git push "$remote" "$tag"

echo "==> Release checkpoint pushed"
echo "commit: $(git rev-parse --short HEAD)"
echo "tag:    ${tag}"

remote_url="$(git remote get-url "$remote")"
repo_path=""
case "$remote_url" in
  git@github.com:*.git)
    repo_path="${remote_url#git@github.com:}"
    repo_path="${repo_path%.git}"
    ;;
  git@github-*:*.git)
    repo_path="${remote_url#*:}"
    repo_path="${repo_path%.git}"
    ;;
  https://github.com/*.git)
    repo_path="${remote_url#https://github.com/}"
    repo_path="${repo_path%.git}"
    ;;
  https://github.com/*)
    repo_path="${remote_url#https://github.com/}"
    ;;
esac

if [[ -n "$repo_path" ]] && command -v python3 >/dev/null 2>&1; then
  echo "==> Checking GitHub Actions"
  python3 - "$repo_path" "$tag" <<'PY' || true
import json
import sys
import time
import urllib.request

repo, tag = sys.argv[1], sys.argv[2]
time.sleep(2)
url = f"https://api.github.com/repos/{repo}/actions/runs?per_page=5"
req = urllib.request.Request(url, headers={
    "Accept": "application/vnd.github+json",
    "User-Agent": "xingkong-release-script",
})
with urllib.request.urlopen(req, timeout=20) as resp:
    data = json.load(resp)
for run in data.get("workflow_runs", []):
    if run.get("head_branch") == tag:
        print(f"{run.get('name')}: {run.get('status')} {run.get('conclusion') or ''}")
        print(run.get("html_url"))
PY
fi
