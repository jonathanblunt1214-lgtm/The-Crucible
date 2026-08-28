# Injection Regression Prevention

Every future injection must treat a failure discovered by the receiving project's own validation as part of assimilation, not as a separate later task.

Before package finalization, discover project-native tests, stress/release/bounded-workload checks, runtime wiring tests, and duplicated repository/governance validators. Record them in the injection prerequisite manifest.

After assimilation on the designated development branch, run both Crucible and the applicable project-native validation. A contradiction between Crucible and a project-owned duplicate validator must be reconciled against the unified governed configuration; it may not be ignored, hidden, or deferred.

A safe in-scope failure automatically enters diagnosis, repair, and retest until passing or genuinely blocked. Assimilation remains incomplete while any required validation is failing.
