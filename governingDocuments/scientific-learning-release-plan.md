# Scientific-learning rolling release plan

## Release decision

The scientific-learning system remains on `development`. A rolling forecast is not authorization to promote learning scope. Promotion of scientific-learning files or behavior to `main` requires every gate below to be complete, a final exact-tip green run, and explicit repository-owner approval. Independently releasable non-learning changes are not blocked by this plan, but their diff and dependencies must first be proven isolated from learning scope and they must follow the repository's normal governed release path.

## Rolling forecast

- Initial forecast: **2026-09-14 at 12:00 PM America/New_York**.
- Confidence: **medium** after the claim-extraction worker processed restart-safe live batches and established measurable throughput.
- Earliest release: the later of the rolling forecast or 72 continuous hours after the final operational gate completes, 72 being the hard floor of the accepted 72-96 hour soak band.
- Review cadence: daily at 12:00 PM America/New_York and immediately after any gate changes state.
- Movement rule: move the forecast forward when measured throughput or a blocker makes the current date unrealistic. Never move it earlier merely because a deadline is desired, and never weaken, waive, average, or reinterpret a gate to preserve a date.
- Completion rule: stop rolling the date only after all gates pass, exact-tip hosted checks are green, owner approval is recorded, and the authorized promotion is verified. The plan itself never authorizes a push to `main`.

## Mandatory gates

| Gate | Required proof | Current state |
| --- | --- | --- |
| R1 Architecture | Durable scientific state machine, safe retrieval, automated Google discovery, monthly refresh, versioning, and rollback are implemented and locally/hosted green. | Passed at `55d3c60bb8034067e643cd39636784a19b991660`. |
| R2 Extraction worker | A real worker consumes `claim-extraction-forced-pending`, increments attempts, persists bounded candidate IDs, and resumes safely after interruption. | In progress: live batches reduced forced web sources from 393 to 288, advanced all seven PDFs to page 11, and persisted candidate IDs without promotion. Restart proof remains pending. |
| R3 Live Google discovery | The scheduled executable search completes one real bounded run, records its query audit, rejects disallowed results, and atomically registers only novel `.edu`, `.org`, or `.gov` URLs. | Pending first scheduled run. |
| R4 End-to-end candidate | At least one real source proceeds from search or owner ingest through safe retrieval, provenance hashing, bounded claim extraction, deduplication, and candidate custody. | Pending. |
| R5 Independent verification | At least one low-risk, falsifiable claim completes controls, causal isolation where applicable, negative/regression tests, deterministic scope proof, contradiction analysis, and a distinct verifier. | Pending; zero verified knowledge versions. |
| R6 Verified-only retrieval | The active verified version is retrieved and used within its tested boundary while unverified and superseded records remain unavailable. | Pending live proof. |
| R7 Rollback or supersession | A real promoted test claim is rolled back or superseded, prior history remains auditable, and active retrieval changes exactly as designed. | Pending live proof. |
| R8 Safety and deduplication | Live kill-switch, duplicate URL, historical content hash, duplicate bounded claim, prompt injection, executable, blocked source, and contradiction cases produce the governed outcomes without promotion. | Unit proof passed; combined live-cycle proof pending. |
| R9 Soak | No lost, duplicated, cross-project, corrupt, or unauthorized transitions occur for a continuous soak of at least 72 and at most 96 hours after R2-R8 pass. | Pending. |
| R10 Release candidate | The literal `development` tip is frozen for the candidate and complete local plus hosted Self-Test, CodeQL, handoff, conflict, monitoring, privacy, security, clutter, docs, and governance checks pass on that exact SHA. | Pending final candidate SHA. |
| R11 Owner authorization | The repository owner explicitly authorizes the exact SHA and promotion operation after reviewing this evidence. | Pending; never inferred. |

## Ordered execution plan

1. Connect and verify the claim-extraction worker; process a small bounded batch before scaling.
2. Complete the first scheduled automated Google run and verify its audit and queue effects.
3. Select one low-risk testable claim from real candidate evidence and execute the full independent scientific pipeline.
4. Prove active-only retrieval, then rollback or supersede that test claim and verify retrieval changes.
5. Exercise live safety and deduplication cases without weakening gates or using private source contents.
6. Begin the soak only after R2-R8 are simultaneously green, run it for a duration chosen inside the 72-96 hour band before it starts, and reset the soak clock on any material failure or state-integrity repair.
7. Freeze the release-candidate SHA on `development`, run exact-tip local and hosted proof, and assemble a concise release evidence report.
8. Request explicit owner authorization for that exact SHA. Promote only after authorization; otherwise keep the plan active and the date rolling.

## Forecast calculation

The daily reviewer uses persisted evidence rather than intuition:

1. Determine the oldest incomplete gate and its exact blocker.
2. For extraction, compute completed sources per successful run and estimate remaining bounded batches; if throughput is zero, mark the forecast low-confidence and move it forward rather than inventing a rate.
3. Add 96 hours - the conservative end of the soak band, never the 72-hour floor - after the estimated completion of R2-R8, so a forecast never depends on the soak finishing at its minimum.
4. Add one release-candidate verification window after soak.
5. Place the rolling target on the next practical owner review window at or after those requirements.
6. Record the prior target, new target, reason, evidence timestamp, gate changes, and exact development SHA in `scientific-learning-release-status.json`.

## Non-negotiable boundaries

- No candidate, retrieval, citation, correlation, telemetry, repetition, newer date, search rank, model judgment, or one-off success is proof.
- No weighted confidence or schedule pressure may bypass a gate.
- R9's soak runs for a continuous duration **anywhere in 72 to 96 hours**, by explicit owner decision on 2026-08-31. 72 hours is a hard floor, not a starting point for negotiation: no evidence, confidence weighting, or schedule pressure may take the soak below it, and a soak interrupted before its chosen duration has not passed R9 at all. Where in the band a given soak sits is decided from evidence before the clock starts, is recorded with that reason, and is never revised downward mid-soak to reach a date. Forecasts use 96 so a date never depends on the soak finishing at its minimum. Changing the band itself requires the owner's explicit instruction, recorded here with its reason, exactly as this decision was.
- Contradictions quarantine as `Crucible Issue`; unsupported claims remain `Insufficient Evidence`; invalid evidence is `Rejected Evidence`.
- No release-plan automation may push, merge, open a promotion pull request, alter branch protection, weaken checks, or authorize itself.
- Scientific-learning scope remains off `main` until its exact authorized promotion operation. Proven-isolated non-learning scope may proceed independently through normal release governance.
