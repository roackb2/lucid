# Lucid representative runtime

This directory owns the execution-host boundary around Lucid's representative
agents. It does not own participants, mailbox visibility, findings, task-state
transitions, or PostgreSQL persistence.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `representative-task-invocation.ts` | Defines the replaceable boundary for one host-routed task invocation |
| `representative-agent-worker.ts` | Runs exactly one routed task through Heddle's targeted execution API |
| `in-process-representative-task-dispatcher.ts` | Provides durable-notification acceleration, due-task polling fallback, bounded delivery, local cancellation, and graceful shutdown |
| `representative-agent-execution-host.ts` | Provides the shared lifecycle seam for Heddle's long-lived scheduler and request-routed targeted execution |
| `representative-agent-execution-composition.ts` | Selects the configured topology and wires task authority, product gate, worker runtime, and redacted telemetry |

## Execution boundary

Lucid must persist participant or mailbox input before requesting a Heddle task
run. The resulting `HeartbeatTaskRunRequestSignal` may be passed to
`InProcessRepresentativeTaskDispatcher.notify()` for low latency. Polling the
durable task catalog remains the correctness fallback when notification is
lost, when a periodic task becomes due, or when the API process restarts.

Every delivery calls a `RepresentativeTaskInvocationTarget` with one task ID.
`RepresentativeAgentWorker` is the local target and delegates direct lookup,
the final due check, execution claim, checkpoint handling, and claim-fenced
settlement to `HeartbeatSchedulerService.runTask()`. It performs no global
scan, subscription, polling, or recovery.

An AgentCore adapter can implement the same invocation-target interface by
sending `taskId`, `invocationId`, and optional run-request generation to one
runtime invocation. Task IDs are internal routing identifiers, not user
authorization; a remote adapter must authenticate its caller and retain the
configured Lucid task namespace.

The dispatcher applies a cooperative wall-clock timeout to every invocation.
A local worker observes the abort signal directly; a remote target must
translate it into cancellation of the addressed remote invocation and await
that invocation's terminal response.

`RepresentativeAgentExecutionHost` is the domain-facing composition seam.
`LongLivedRepresentativeAgentExecutionHost` preserves the supported Heddle
scheduler path for zero-setup local mode. `TargetedRepresentativeAgentExecutionHost`
uses the dispatcher and can replace only its invocation target for AgentCore;
the heartbeat domain does not branch on deployment topology.

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
the Heddle task authority. A future AgentCore target must be able to stop and
await the specific remote invocation before participant disable or retirement
can safely move Lucid's mailbox eligibility boundary.

Both execution hosts classify a durable `running` task without matching local
ownership as `not-owned`. Participant disable, retirement, and reset must fail
closed on that result. Stopping an entire remote runtime session is not a safe
substitute unless the adapter can prove that session owns the exact task
invocation and await its Heddle settlement.

## Global gate and shutdown

`isGloballyEnabled()` must read Lucid's durable operator-level background-work
flag. The dispatcher checks it before scans and before admitting pending work.
The Lucid wake handler must check the same durable flag again before claiming a
mailbox because the operator may pause after dispatch admission.

Global pause is admission policy, not participant preference. It leaves every
Heddle task's `enabled` field unchanged, continues accepting durable run
requests, aborts and awaits only locally owned work, and resumes with an
immediate correctness scan. Participant pause remains a one-task cancellation
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
