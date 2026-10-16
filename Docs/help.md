## Wallet Security Notes

* Production systems must disable core dumps before handling generated Stellar secrets.
* The application cannot enforce this limit for its parent shell. At startup,
checkCoreDumpsDisabled() in src/index.ts runs ulimit -c and only logs a warning;
it never changes the limit or refuses to start.
* The warning is emitted with the message text "Core dumps may be enabled"
(alongside the observed ulimit_c value) whenever the reported limit is neither
0 nor unlimited. A limit of 0 or unlimited produces no warning, so a deployment
that never reads its logs will still start even when core dumps are enabled.
* The operator must apply the limit outside the process, for example via
ulimit -c 0 or the platform equivalent (e.g. a container or systemd setting,
or the orchestrator's core-dump policy) before handling generated Stellar
secrets.
* Avoid logging secret values, even in debug builds.
