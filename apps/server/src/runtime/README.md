# Embedded heartbeat composition

This directory contains only Lucid's composition of Heddle's supported
targeted heartbeat host. Heddle owns polling, bounded delivery, cancellation,
recovery, execution claims, checkpoints, and settlement. Lucid supplies its
durable product admission gate, runtime configuration, redacted logging, and
the wake handler that owns mailbox and finding behavior.

## Owned file

| File | Responsibility |
| --- | --- |
| `agent-execution-composition.ts` | Inject Lucid product inputs into `HeartbeatTargetedTaskHost` and `HeartbeatTargetedTaskWorker` |

There is intentionally no Lucid dispatcher, worker, host lifecycle, task-store
implementation, or renamed invocation contract here. Those public components
come directly from `@heddleagent/runtime/advanced`; PostgreSQL authority comes
from `@heddleagent/postgres/heartbeat`.

## Product boundary

Lucid must persist mailbox input before it requests a Heddle task run. The
embedded `AgentHeartbeatService` owns fixed mailbox horizons, wake claims,
product-tool effects, and fenced product settlement. It passes Heddle's
run-request signal to the package host for low latency, while Heddle polling
remains the correctness fallback after a lost notification or process restart.

Lucid's global background-work preference is injected through
`isAdmissionEnabled`. The wake handler checks the same durable preference again
before claiming product work, because it may change after host admission.
Shutdown stops and settles the Heddle host before PostgreSQL closes.

The embedded path remains only until the external coordinator Runtime can call
state-changing, claim-fenced Lucid MCP operations. See
[`../../../../docs/hosted-execution.md`](../../../../docs/hosted-execution.md).
