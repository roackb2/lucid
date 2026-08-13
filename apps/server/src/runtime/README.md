# Lucid agent runtime

This directory owns the execution-host boundary around Lucid's agent
agents. It does not own users, mailbox visibility, findings, task-state
transitions, or PostgreSQL persistence.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `agent-task-invocation.ts` | Defines the internal boundary for one locally routed task invocation |
| `agent-worker.ts` | Runs exactly one routed task through Heddle's targeted execution API |
| `in-process-agent-task-dispatcher.ts` | Provides durable-notification acceleration, due-task polling fallback, bounded delivery, local cancellation, and graceful shutdown |
| `agent-execution-host.ts` | Provides the shared lifecycle seam for Heddle's long-lived scheduler and request-routed targeted execution |
| `agent-execution-composition.ts` | Selects the configured topology and wires task authority, product gate, worker runtime, and redacted telemetry |

## Execution boundary

Lucid must persist user or mailbox input before requesting a Heddle task
run. The resulting `HeartbeatTaskRunRequestSignal` may be passed to
`InProcessAgentTaskDispatcher.notify()` for low latency. Polling the
durable task catalog remains the correctness fallback when notification is
lost, when a periodic task becomes due, or when the API process restarts.

Every delivery calls a `AgentTaskInvocationTarget` with one task ID.
`AgentWorker` delegates direct lookup, the final due check,
execution claim, checkpoint handling, and claim-fenced settlement to
`HeartbeatSchedulerService.runTask()`. It performs no global scan,
subscription, polling, or recovery.

This target is an in-process boundary, not a remote service contract. Its
invocation contains an `AbortSignal`, its result is Heddle's targeted-task
result, and the worker requires both the PostgreSQL task store and Lucid's
handler closure. A task ID is also a routing identifier, never user or tenant
authorization.

The dispatcher applies a cooperative wall-clock timeout to every invocation.
The local worker observes the abort signal directly and must settle before
shutdown can close persistence.

`AgentExecutionHost` is the domain-facing composition seam.
`LongLivedAgentExecutionHost` preserves the supported Heddle
scheduler path for zero-setup local mode. `TargetedAgentExecutionHost`
uses the dispatcher to run bounded workers without changing heartbeat-domain
policy.

An external Heddle host needs a different, serializable agent-turn contract.
Lucid must keep product identity, task and wake fencing, PostgreSQL authority,
and durable settlement, while the runtime calls curated domain operations
through tenant-scoped MCP capabilities. See
[`../../../../docs/hosted-execution.md`](../../../../docs/hosted-execution.md).

## Retry and cancellation

Heddle outcomes already encode durable task state:

- `busy` and `claim-lost` are transient delivery contention and receive one
  short dispatcher retry;
- `retry`, `failed`, `not-due`, and `cancelled` wait for Heddle's persisted
  schedule and the polling fallback; and
- `settled`, `not-found`, and `disabled` complete the current delivery.

The dispatcher tracks at most one active invocation per task in this process.
`cancelTask()` aborts and awaits that local invocation but does not disable the
durable Heddle task. The caller must coordinate durable task lifecycle through
the Heddle task authority. Any future external execution adapter must stop and
await its specifically owned invocation before user disable or
retirement can safely move Lucid's mailbox eligibility boundary.

Both execution hosts classify a durable `running` task without matching local
ownership as `not-owned`. User disable, retirement, and reset must fail
closed on that result. Stopping an entire remote runtime session is not a safe
substitute unless the adapter can prove that session owns the exact task
invocation and await its Heddle settlement.

## Global gate and shutdown

`isGloballyEnabled()` must read Lucid's durable operator-level background-work
flag. The dispatcher checks it before scans and before admitting pending work.
The Lucid wake handler must check the same durable flag again before claiming a
mailbox because the operator may pause after dispatch admission.

Global pause is admission policy, not user preference. It leaves every
Heddle task's `enabled` field unchanged, continues accepting durable run
requests, aborts and awaits only locally owned work, and resumes with an
immediate correctness scan. User pause remains a one-task cancellation
followed by a Heddle administration update.

Shutdown stops polling and admission first, aborts active work by default,
awaits every invocation, and only then lets the composition root close task
and product persistence. Workers never infer that a different execution owner
is dead; lease expiry and interrupted-task recovery remain explicit host/store
policy outside this directory.

The targeted host runs bounded, non-overlapping recovery sweeps and scans again
after each sweep. The configured recovery interval and invocation timeout must
both be shorter than the execution lease. The PostgreSQL authority alone
decides whether a lease is actually expired and fences every late settlement.
A one-time startup recovery is insufficient: a live lease skipped at startup
would otherwise remain stuck after it expires.
