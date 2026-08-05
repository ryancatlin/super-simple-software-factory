# Validation Task

## Variables

### prompt

{{prompt}}

### previous_envelope

{{previous_envelope}}

### context_handoff_dir

{{context_handoff_dir}}

## Task

Rule on whether the captured evidence shows the running app doing what `prompt` asked.

1. List the scenarios the request implies — each thing the app should demonstrably do.
2. Read the evidence in every `previous_envelope.evidence_dirs` entry: `flow.log`, saved responses, snapshots, screenshots.
3. Rule on every scenario — one `scenarios` entry each, citing the evidence file.
4. Write your ruling to `<context_handoff_dir>/validation_report.md`, then emit your `Report` JSON.

## Report

Respond with ONLY valid JSON matching `ValidateOutput` — no prose before or after:

```json
{
  "status": "success",
  "passed": false,
  "summary": "<one sentence: N of M scenarios passed>",
  "scenarios": [
    { "scenario": "<what the app should demonstrably do>", "passed": true, "evidence": "<evidence_dir>/home.html — 200, expected heading present" }
  ],
  "blocking": ["<what must change before validation can pass>"],
  "artifacts": ["<context_handoff_dir>/validation_report.md"],
  "notes_for_next_agent": "<what the builder must fix, or how this was verified if passed>"
}
```

`status` is `success` when the validation itself completed — it is not the verdict. The verdict is `passed`, and it is true only when `scenarios` has no failed entry and `blocking` is empty.
