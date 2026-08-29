{
  "schemaVersion": 1,
  "canonicalBranch": "main",
  "links": [
    {
      "branch": "Plug-in",
      "relationship": "canonical-reference",
      "dependsOn": "main",
      "requiredMainPaths": [
        "AI-HANDOFF.json"
      ],
      "automaticRepair": {
        "enabled": true,
        "followGitRenames": true,
        "rewriteRecognizedReferences": true,
        "retestAfterRepair": true,
        "forcePush": false,
        "unsafeOrSemanticChange": "fail-closed"
      },
      "reason": "Plug-in is intentionally plugin-only and references shared Crucible governance from canonical main instead of duplicating it. Its branch name does not express that dependency, so the link is declared explicitly."
    }
  ]
}
