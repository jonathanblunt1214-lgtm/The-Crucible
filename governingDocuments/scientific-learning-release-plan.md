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
| R5 Independent verification | At least one low-risk claim persists a hash-bound pre-result hypothesis/test-variable plan, then completes controls, causal isolation where applicable, negative/regression tests, deterministic scope proof, contradiction analysis, and a distinct verifier against that unchanged plan. | Pending; zero verified knowledge versions. |
| R6 Verified-only retrieval | The active verified version is retrieved and used within its tested boundary while unverified and superseded records remain unavailable. | Pending live proof. |
| R7 Rollback or supersession | A real promoted test claim is rolled back or superseded, prior history remains auditable, and active retrieval changes exactly as designed. | Pending live proof. |
| R8 Safety and deduplication | Live kill-switch, duplicate URL, historical content hash, duplicate bounded claim, prompt injection, executable, blocked source, and contradiction cases produce the governed outcomes without promotion. | Unit proof passed; combined live-cycle proof pending. |
| R9 Soak | No lost, duplicated, cross-project, corrupt, or unauthorized transitions occur across the observed population for a continuous soak of at least 72 and at most 96 hours after R2-R8 pass. At most 1000 data points are observed at once, and the soak does not start at all while the current data cannot exhibit the failures it is looking for. | Pending; held. `src/soakGate.js` currently reports `held` with zero verified knowledge versions and no active version. |
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
- The semantic analyzers are **learning-system components**, by explicit owner decision on 2026-08-31 - not independent tooling that happens to sit nearby. Two consequences follow. A degraded analyzer is a learning blockage that inhibits the analysis depending on it, rather than an unrelated failure someone else owns. And the analyzers sit inside learning scope for release purposes, so they are not independently releasable ahead of R11: the "proven-isolated non-learning scope" exemption above does not reach them.
- **Governance monitors these gates and adjusts the pipeline around a blockage, and holds no authority over proof.** `src/learningGovernance.js` keeps that line mechanical rather than documentary. It may reprioritize, hold, throttle, route, and deprioritize work - a closed allow-list of flow controls - and it may never promote a claim, verify one, mark a gate passed, authorize a release, start a soak the gate is holding, repair the durable store, shorten a soak, or discard evidence. Those sit in `FORBIDDEN_ACTIONS` so that permitting one has to delete that line rather than quietly widen what governance does. A blockage governance could clear by relaxing a gate is not a blockage - it is the gate doing its job - and it is escalated to the owner instead of worked around.
- R9's observed population is one data point per durable record: each verified knowledge version, each candidate record, and each queued source. The active version is a pointer at a knowledge version already counted, not a separate point. **At most 1000 data points are observed at once**, by explicit owner decision on 2026-08-31. Anything beyond that ceiling is held, never dropped: observed plus held always equals the whole population, and `test/soakGate.test.js` asserts that rather than assuming it. The window is filled deterministically - transition-bearing records first, then stable id order - so a soak window can be replayed and re-checked instead of trusted.
- **A soak that would return no result does not start.** By explicit owner decision on 2026-08-31, when the current data cannot exhibit the failures R9 names, all data is held until the population is usable as intended. A soak run over a population that structurally cannot fail is not evidence; it passes by being empty, which is worse than no soak because it looks like proof. `src/soakGate.js` reports `held` with the exact missing conditions - no verified knowledge versions means no promotion or supersession can be observed, no active version means verified-only retrieval cannot be observed, and no candidates or queued sources means loss and duplication cannot be observed - and it never reports a pass, because passing is what the soak itself must establish over its duration.
- R9's soak runs for a continuous duration **anywhere in 72 to 96 hours**, by explicit owner decision on 2026-08-31. 72 hours is a hard floor, not a starting point for negotiation: no evidence, confidence weighting, or schedule pressure may take the soak below it, and a soak interrupted before its chosen duration has not passed R9 at all. Where in the band a given soak sits is decided from evidence before the clock starts, is recorded with that reason, and is never revised downward mid-soak to reach a date. Forecasts use 96 so a date never depends on the soak finishing at its minimum. Changing the band itself requires the owner's explicit instruction, recorded here with its reason, exactly as this decision was.
- Contradictions quarantine as `Crucible Issue`; unsupported claims remain `Insufficient Evidence`; invalid evidence is `Rejected Evidence`.
- No release-plan automation may push, merge, open a promotion pull request, alter branch protection, weaken checks, or authorize itself.
- Scientific-learning scope remains off `main` until its exact authorized promotion operation. Proven-isolated non-learning scope may proceed independently through normal release governance.
