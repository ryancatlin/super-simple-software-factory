"""Claude Code interface — the v2 adapter (was a STUB in v1).

Runs `claude -p --output-format stream-json` and tails its NDJSON stdout line
by line, forwarding events to a callback WHILE the agent works (same streaming
crack as agent_pi). `--session-id <uuid>` creates-or-continues, so running and
continuing an agent are the same call: same id = same context window.

Resume semantics differ from pi: pi accepts an arbitrary string as
--session-id, but Claude Code wants either a UUID it hands back (in the final
`result` event) or a previous claude-generated session id via --resume. So the
first call in a chain runs fresh; the adapter returns the claude session_id it
got, and the caller stores it in agent_map so a correction/continue re-enters
the SAME window via --resume.

Cost note: unlike pi, claude -p through a subscription/API login does NOT bill
per token on OpenRouter. `total_cost_usd` in the result event is still parsed
so the trace shows *something*, but it is a flat-seat figure, not a metered one.
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import Callable, Optional

from .data_types import PiResult, UsageBreakdown
from .utils import now_iso

CLAUDE_PATH = os.environ.get("CLAUDE_PATH", "claude")

RESULT_SNIPPET_CHARS = 20_000
LABEL_CHARS = 80


class ClaudeRequest:
    """Everything one non-interactive claude -p run needs.

    Mirrors PiRequest's shape (agents.py builds both), minus pi-only concepts
    (provider resolution, extensions). `session_id` is a claude session id from
    a prior `result` event, or "" for a fresh run.
    """

    def __init__(
        self,
        prompt: str,
        system_prompt: str,
        model: str = "sonnet",
        thinking: str = "medium",
        session_id: str = "",
        cwd: str = ".",
        raw_output_path: str = "",
        tools: Optional[list[str]] = None,
    ) -> None:
        self.prompt = prompt
        self.system_prompt = system_prompt
        self.model = model
        self.thinking = thinking
        self.session_id = session_id
        self.cwd = cwd
        self.raw_output_path = raw_output_path
        self.tools = tools


def _label(tool: str, args: dict) -> str:
    """One-line human name for a tool call: `bash: ls -la src`."""
    for key in ("command", "path", "file_path", "pattern", "query", "url"):
        value = args.get(key) if isinstance(args.get(key), str) else ""
        value = " ".join(str(value).split())
        if value:
            return f"{tool}: {value[:LABEL_CHARS]}"
    return tool


def run(
    request: ClaudeRequest,
    on_event: Optional[Callable[[dict], None]] = None,
    on_spawn: Optional[Callable[[int], None]] = None,
    on_exit: Optional[Callable[[int], None]] = None,
) -> PiResult:
    """Run one non-interactive claude -p turn and return a PiResult-shaped value.

    `on_spawn(pid)` and `on_exit(pid)` bracket the child process so the caller
    can record it as killable — a hung coding agent is otherwise a pid you have
    to hunt for in `ps`.
    """
    result = PiResult(session_id=request.session_id)
    raw_path = Path(request.raw_output_path) if request.raw_output_path else None
    if raw_path:
        raw_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [CLAUDE_PATH, "-p", "--output-format", "stream-json", "--verbose"]
    if request.session_id:
        # continue an existing window (a correction, or a chained workflow)
        cmd += ["--resume", request.session_id]
    else:
        # fresh window, pinned to a UUID we control so agent_map is stable
        cmd += ["--session-id", str(uuid.uuid4())]
    if request.model:
        cmd += ["--model", request.model]
    if request.thinking and request.thinking != "medium":
        cmd += ["--effort", request.thinking]
    if request.system_prompt:
        cmd += ["--append-system-prompt", request.system_prompt]
    if request.tools:
        cmd += ["--allowedTools", ",".join(request.tools)]
    # The builder must edit files and run gates (lint/tests) to verify its work.
    # This is a factory: the human is not there to approve every Write/Bash.
    cmd += ["--permission-mode", "acceptEdits", "--dangerously-skip-permissions"]
    cmd.append(request.prompt)

    process = subprocess.Popen(
        cmd, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1, cwd=request.cwd,
    )
    if on_spawn:
        on_spawn(process.pid)

    # Accumulators. Claude's stream-json is a sequence of system/stream_event/
    # result lines; the authoritative final answer rides the `result` line, and
    # text streams through content_block_delta events as it is generated.
    final_text = ""
    session_id = request.session_id
    cost = 0.0
    usage = UsageBreakdown()

    def parse_stream(line: str) -> None:
        nonlocal final_text, session_id, cost, usage
        if not line.strip():
            return
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            return
        etype = event.get("type")
        if etype == "stream_event":
            inner = event.get("event", {}) or {}
            # text is generated incrementally; concatenate deltas
            if inner.get("type") == "content_block_delta":
                delta = inner.get("delta", {}) or {}
                if delta.get("type") == "text_delta":
                    final_text += delta.get("text", "")
            elif inner.get("type") == "tool_use":
                tool = inner.get("name", "tool")
                args = inner.get("input", {}) or {}
                if on_event:
                    on_event({"type": "tool_call", "tool": tool, "args": args,
                              "label": _label(tool, args),
                              "tool_call_id": inner.get("id", "")})
        elif etype == "result":
            final_text = event.get("result", final_text) or final_text
            session_id = event.get("session_id") or session_id
            cost = event.get("total_cost_usd", cost) or cost
            u = event.get("usage", {}) or {}
            if u:
                usage = UsageBreakdown(
                    input_tokens=u.get("input_tokens", 0),
                    output_tokens=u.get("output_tokens", 0),
                    cache_read_tokens=u.get("cache_read_input_tokens", 0),
                    total_tokens=u.get("total_tokens", 0),
                    total_cost=cost,
                )
        if on_event:
            on_event(event)

    assert process.stdout is not None
    if raw_path:
        with raw_path.open("a") as raw:
            for line in process.stdout:
                raw.write(line)
                raw.flush()
                parse_stream(line)
    else:
        for line in process.stdout:
            parse_stream(line)

    stderr = process.stderr.read() if process.stderr else ""
    result.text = final_text
    result.session_id = session_id
    result.cost = cost
    result.usage = usage
    result.tokens = usage.total_tokens
    result.returncode = process.wait()
    if on_exit:
        on_exit(process.pid)

    if result.returncode != 0 and not result.text:
        raise RuntimeError(
            f"claude exited {result.returncode}: {stderr.strip()[-800:]}")
    return result
