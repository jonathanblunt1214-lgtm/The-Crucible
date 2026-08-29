# Copy this file to a new repository's main branch, replace the pinned
# Crucible SHA, and run it manually in two phases. Install creates the
# governance baseline and required Development-branch. Activate is allowed only after
# a representative pull request has produced both named checks.
name: Connect The Crucible governance

on:
  workflow_dispatch:
    inputs:
      phase:
        description: Install first; activate only after a representative PR is green
        required: true
        type: choice
        options: [install, activate]
      representative_pr:
        description: Pull request number whose head reported both AI checks
        required: false
        type: string
      activation_confirmation:
        description: Type ACTIVATE_CRUCIBLE_GOVERNANCE to activate
        required: false
        type: string

permissions:
  contents: write
  pull-requests: read

jobs:
  install:
    if: inputs.phase == 'install'
    name: Install AI governance and required branches
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Require the literal default branch
        env:
          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
          SELECTED_BRANCH: ${{ github.ref_name }}
        run: |
          set -euo pipefail
          test "$DEFAULT_BRANCH" = main || { echo "Refusing installation: the default branch must be main." >&2; exit 1; }
          test "$SELECTED_BRANCH" = main || { echo "Refusing installation: dispatch this phase from main." >&2; exit 1; }
      - name: Check out this repository
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          fetch-depth: 0
      - name: Check out the pinned Crucible engine (read-only)
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          repository: jonathanblunt1214-lgtm/The-Crucible
          ref: REPLACE_WITH_EXACT_COMMIT_SHA
          path: .the-crucible-runtime
          persist-credentials: false
      - name: Install mandatory AI governance and governingDocuments filename parity
        # Idempotent by design. The pinned Crucible runtime is the source of truth
        # for governingDocuments filenames; every missing relative name is created
        # as a project-local reference/overlay, while any project file that already
        # exists at that exact path is preserved. This prevents injected projects
        # from drifting when canonical Crucible governance adds another document.
        run: |
          set -euo pipefail
          mkdir -p templates
          cp .the-crucible-runtime/templates/the-crucible-design-brief.md THE-CRUCIBLE-DESIGN-BRIEF.md
          cp .the-crucible-runtime/templates/ai-conflicts.example.json AI-CONFLICTS.json
          cp .the-crucible-runtime/templates/ai-handoff.example.json AI-HANDOFF.json
          cp .the-crucible-runtime/templates/ai-conflict-monitor-workflow.yml .github/workflows/ai-conflict-governance.yml
          cp .the-crucible-runtime/templates/ai-handoff-policy-workflow.yml .github/workflows/ai-handoff-policy.yml
          [ -f templates/ai-conflict-resolution.md ] || cp .the-crucible-runtime/templates/ai-conflict-resolution.md templates/ai-conflict-resolution.md
          [ -f templates/required-check-rollout.md ] || cp .the-crucible-runtime/templates/required-check-rollout.md templates/required-check-rollout.md
          node .the-crucible-runtime/src/injectedGovernance.js .the-crucible-runtime/governingDocuments governingDocuments AI-HANDOFF.json
          rm -rf .the-crucible-runtime
          changed="$(git status --porcelain -uall)"
          count="$(printf '%s\n' "$changed" | grep -c . || true)"
          if [ "$count" -eq 0 ]; then
            echo "Governance files already installed and unchanged - resuming a previous run. Nothing to commit."
          else
            mandatory_missing=0
            for f in AI-CONFLICTS.json AI-HANDOFF.json THE-CRUCIBLE-DESIGN-BRIEF.md .github/workflows/ai-conflict-governance.yml .github/workflows/ai-handoff-policy.yml; do
              printf '%s\n' "$changed" | grep -qF "$f" || mandatory_missing=1
            done
            unexpected="$(printf '%s\n' "$changed" | sed -E 's/^.{2} //' | grep -v '^governingDocuments/' | grep -vFx -e 'AI-CONFLICTS.json' -e 'AI-HANDOFF.json' -e 'THE-CRUCIBLE-DESIGN-BRIEF.md' -e '.github/workflows/ai-conflict-governance.yml' -e '.github/workflows/ai-handoff-policy.yml' -e 'templates/ai-conflict-resolution.md' -e 'templates/required-check-rollout.md' || true)"
            if [ "$mandatory_missing" -eq 1 ] || [ -n "$unexpected" ]; then
              echo "Refusing to commit: expected the mandatory AI governance files plus only project-local governingDocuments names derived from the pinned Crucible runtime. Found:" >&2
              printf '%s\n' "$changed" >&2
              exit 1
            else
              git config user.name "github-actions[bot]"
              git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
              git add -A
              git commit -m "Install Crucible AI governance"
              git push origin HEAD:refs/heads/main
            fi
          fi
      - name: Create required Development-branch at the governance commit
        run: |
          set -euo pipefail
          set +e
          git ls-remote --exit-code --heads origin refs/heads/Development-branch >/dev/null 2>&1
          status=$?
          set -e
          if [ "$status" -eq 0 ]; then
            echo "Refusing to replace existing Development-branch." >&2
            exit 1
          elif [ "$status" -ne 2 ]; then
            echo "Could not confirm whether Development-branch exists (git ls-remote exited $status); refusing to guess. Check connectivity and access, then retry." >&2
            exit 1
          fi
          git push origin HEAD:refs/heads/Development-branch
      - name: Preserve the safe enforcement boundary
        run: echo "Both required branches now exist: main and Development-branch. Open a representative Development-branch to main pull request. Do not activate until both AI checks succeed."

  activate:
    if: inputs.phase == 'activate'
    name: Verify promotion and activate governance
    runs-on: ubuntu-latest
    timeout-minutes: 5
    env:
      GH_TOKEN: ${{ secrets.CRUCIBLE_ADMIN_TOKEN }}
      REPOSITORY: ${{ github.repository }}
    steps:
      - name: Require explicit activation authority
        env:
          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}
          SELECTED_BRANCH: ${{ github.ref_name }}
          CONFIRMATION: ${{ inputs.activation_confirmation }}
          REPRESENTATIVE_PR: ${{ inputs.representative_pr }}
        run: |
          set -euo pipefail
          test "$DEFAULT_BRANCH" = main || { echo "Refusing activation: the default branch must be main." >&2; exit 1; }
          test "$SELECTED_BRANCH" = main || { echo "Refusing activation: dispatch this phase from main." >&2; exit 1; }
          test "$CONFIRMATION" = ACTIVATE_CRUCIBLE_GOVERNANCE || { echo "Refusing activation: exact owner confirmation is missing." >&2; exit 1; }
          test -n "$REPRESENTATIVE_PR" || { echo "Refusing activation: a representative pull request is required." >&2; exit 1; }
          test -n "$GH_TOKEN" || { echo "Refusing activation: CRUCIBLE_ADMIN_TOKEN is missing." >&2; exit 1; }
      - name: Check out promoted main
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          ref: main
          fetch-depth: 0
          persist-credentials: false
      - name: Verify promoted workflows and representative checks
        env:
          REPRESENTATIVE_PR: ${{ inputs.representative_pr }}
        run: |
          set -euo pipefail
          test -f .github/workflows/ai-conflict-governance.yml
          test -f .github/workflows/ai-handoff-policy.yml
          test -f AI-CONFLICTS.json
          test -f AI-HANDOFF.json
          pr="$(gh api "repos/$REPOSITORY/pulls/$REPRESENTATIVE_PR")"
          test "$(printf '%s' "$pr" | jq -r .base.ref)" = main || { echo "Representative pull request must target main." >&2; exit 1; }
          head_sha="$(printf '%s' "$pr" | jq -r .head.sha)"
          checks="$(gh api --paginate -H 'Accept: application/vnd.github+json' "repos/$REPOSITORY/commits/$head_sha/check-runs?per_page=100" --jq '.check_runs[] | select(.conclusion == "success") | .name')"
          printf '%s\n' "$checks" | grep -Fxq 'AI conflict governance' || { echo "AI conflict governance has not succeeded on the representative pull request." >&2; exit 1; }
          printf '%s\n' "$checks" | grep -Fxq 'AI handoff policy' || { echo "AI handoff policy has not succeeded on the representative pull request." >&2; exit 1; }
      - name: Apply zero-bypass repository rulesets
        run: |
          set -euo pipefail
          default_rules="$(jq -n '{name:"Crucible default branch governance",target:"branch",enforcement:"active",bypass_actors:[],conditions:{ref_name:{include:["~DEFAULT_BRANCH"],exclude:[]}},rules:[{type:"deletion"},{type:"non_fast_forward"},{type:"pull_request",parameters:{dismiss_stale_reviews_on_push:false,require_code_owner_review:false,require_last_push_approval:false,required_approving_review_count:0,required_review_thread_resolution:true}},{type:"required_status_checks",parameters:{strict_required_status_checks_policy:true,do_not_enforce_on_create:true,required_status_checks:[{context:"AI conflict governance"},{context:"AI handoff policy"}]}}]}')"
          scope_rules="$(jq -n '{name:"AI branch scope - Development-branch only",target:"branch",enforcement:"active",bypass_actors:[],conditions:{ref_name:{include:["~ALL"],exclude:["refs/heads/main","refs/heads/Development-branch"]}},rules:[{type:"creation"},{type:"update"},{type:"deletion"}]}')"
          apply_ruleset() {
            name="$1"; body="$2"
            id="$(gh api --paginate "repos/$REPOSITORY/rulesets?includes_parents=false" --jq ".[] | select(.name == \"$name\") | .id" | head -n1)"
            if [ -n "$id" ]; then
              printf '%s' "$body" | gh api --method PUT "repos/$REPOSITORY/rulesets/$id" --input - >/dev/null
            else
              printf '%s' "$body" | gh api --method POST "repos/$REPOSITORY/rulesets" --input - >/dev/null
            fi
          }
          apply_ruleset 'Crucible default branch governance' "$default_rules"
          apply_ruleset 'AI branch scope - Development-branch only' "$scope_rules"
      - name: Confirm governance
        run: echo "Both required branches exist: main and Development-branch. main is protected; Development-branch is the only AI development branch; other branch creation, update, and deletion are blocked."
