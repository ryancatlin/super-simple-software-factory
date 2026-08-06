# Audit Task

## Variables

### prompt

{{prompt}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Audit the proof, not the app. The exit codes in `previous_envelope` already decided whether the running app behaved; your ruling is a veto on dishonest instruments and degraded evidence.

1. List your audit scenarios: criteria-vs-request (when `prompt` carries acceptance criteria and a coverage mapping), probes-vs-criteria (open each cited script — do its assertions test the criterion, not less?), assertion strength (name each script's WEAKEST assertion and say whether the feature could break visibly while the script stays green — if it could, that is a red), and evidence sanity per `previous_envelope.evidence_dirs` entry (start with `toolkit.txt`; blank-flagged screenshots and unexplained baseline drift are degraded evidence).
2. Rule on every scenario — one `scenarios` entry each, citing the script or evidence file.
3. Write your ruling to `<context_handoff_dir>/validation_report.md`, then emit your `Report` JSON.

## Report

Respond with ONLY valid JSON matching `AuditOutput` — no prose before or after:

```json
{
  "status": "success",
  "passed": false,
  "summary": "<one sentence: N of M audit scenarios passed>",
  "scenarios": [
    { "scenario": "<what was audited: a criterion's honesty, a probe's assertions, an evidence dir's sanity>", "passed": true, "evidence": "<the script or evidence file behind the ruling>" }
  ],
  "blocking": ["<the specific dishonesty or degradation that must be fixed>"],
  "artifacts": ["<context_handoff_dir>/validation_report.md"],
  "notes_for_next_agent": "<what must change, or what was verified if passed>"
}
```

`status` is `success` when the audit itself completed — it is not the verdict. The verdict is `passed`, and it is true only when `scenarios` has no failed entry and `blocking` is empty. Remember: your green does not make the run pass — the exit codes do; your red makes it fail.
