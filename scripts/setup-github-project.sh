#!/usr/bin/env bash
set -euo pipefail

OWNER="larai-w"
REPO="GutPacer-ParkinSync-Module"
PROJECT_TITLE="GutPacer Delivery"
EXECUTE=false

if [[ "${1:-}" == "--execute" ]]; then
  EXECUTE=true
fi

if [[ "$EXECUTE" != true ]]; then
  cat <<'PLAN'
Dry run: no GitHub state was changed.

This script will:
1. create or reuse the user-owned "GutPacer Delivery" Project;
2. create Priority, Phase, Area, Size, and Target fields;
3. create the PM labels used by the repository;
4. add all existing GutPacer issues to the Project;
5. set the GUTPACER_PROJECT_URL repository variable.

Prerequisite: gh auth login -h github.com -s repo,project
Run: scripts/setup-github-project.sh --execute
PLAN
  exit 0
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login -h github.com -s repo,project" >&2
  exit 1
fi

project_number="$(gh project list --owner "$OWNER" --format json --jq ".projects[] | select(.title == \"$PROJECT_TITLE\") | .number" | head -n 1)"

if [[ -z "$project_number" ]]; then
  gh project create --owner "$OWNER" --title "$PROJECT_TITLE" >/dev/null
  project_number="$(gh project list --owner "$OWNER" --format json --jq ".projects[] | select(.title == \"$PROJECT_TITLE\") | .number" | head -n 1)"
fi

if [[ -z "$project_number" ]]; then
  echo "Could not resolve the project number after creation." >&2
  exit 1
fi

field_names="$(gh project field-list "$project_number" --owner "$OWNER" --format json --jq '.fields[].name')"

create_field() {
  local name="$1"
  local options="$2"
  if ! grep -Fxq "$name" <<<"$field_names"; then
    gh project field-create "$project_number" --owner "$OWNER" --name "$name" \
      --data-type SINGLE_SELECT --single-select-options "$options" >/dev/null
  fi
}

create_field "Priority" "P0,P1,P2,P3"
create_field "Phase" "Foundation,Closed beta,10 families,30 families,Later"
create_field "Area" "Product,Frontend,API,Data,LINE,Notifications,Security,Operations,Research,Content"
create_field "Size" "XS,S,M,L"
create_field "Target" "Unscheduled,Current,Next,Later"

create_label() {
  local name="$1"
  local color="$2"
  local description="$3"
  gh label create "$name" --repo "$OWNER/$REPO" --color "$color" \
    --description "$description" --force >/dev/null
}

create_label "type:user-story" "1D76DB" "User-facing outcome with acceptance criteria"
create_label "type:task" "5319E7" "Delivery work supporting an outcome"
create_label "type:research" "D4C5F9" "Discovery, interview, or validation work"
create_label "priority:P0" "B60205" "Safety or release blocker"
create_label "priority:P1" "D93F0B" "Required for the current MVP outcome"
create_label "priority:P2" "FBCA04" "Valuable after the MVP baseline"
create_label "priority:P3" "C5DEF5" "Explore later"
create_label "status:blocked" "B60205" "Cannot progress without a dependency or decision"
create_label "status:needs-validation" "0E8A16" "Implementation exists but outcome validation remains"
create_label "risk:privacy" "D73A4A" "Privacy or user data boundary risk"
create_label "risk:health-copy" "D73A4A" "Health-related claim or positioning risk"

project_url="https://github.com/users/$OWNER/projects/$project_number"
gh variable set GUTPACER_PROJECT_URL --repo "$OWNER/$REPO" --body "$project_url"

while IFS= read -r issue_url; do
  gh project item-add "$project_number" --owner "$OWNER" --url "$issue_url" >/dev/null
done < <(gh issue list --repo "$OWNER/$REPO" --state all --limit 200 --json url --jq '.[].url')

cat <<EOF
Project ready: $project_url

Remaining secret setup:
1. Create a fine-grained token with Projects read/write and this repository's Issues/PRs read access.
2. Run: gh secret set PROJECTS_TOKEN --repo $OWNER/$REPO
EOF
