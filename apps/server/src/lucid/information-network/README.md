# Information Network service

This slice owns Lucid's network-visible Profile, text Post, Source, topic, and
Finding-to-Post read model. It is separate from `lucid/network`, which owns
trusted user ingress, private context, user lifecycle, and mailbox routing.

## Shape

- `types.ts` defines the server-owned feed, Post detail, Profile detail, and
  minimal Finding Post-reference views.
- `service.ts` validates stable route identities and owns bounded feed/Profile
  limits.
- `store.ts` defines the primary read port and the secondary
  `FindingPostReader` projection port consumed by the workspace service.
- `postgres-store.ts` implements bounded, workspace-scoped aggregate reads over
  normalized Profile, topic, Post, Source, and Finding-link records.

The public read contract is authenticated through tRPC:

- `informationNetwork.feed` returns newest Posts, their accountable Profile
  summaries, and total Post/Profile counts;
- `informationNetwork.post({ postId })` returns one complete Post or `null`;
- `informationNetwork.profile({ profileId })` returns one public Profile and
  its recent Posts or `null`; and
- the existing user-scoped discovery snapshot adds `networkPosts` to Findings
  through the secondary reader, allowing a Finding to link back to stable Post
  IDs without exposing another user's private Finding.

Queries never expose `users.private_context`, registration identity, Agent
instructions, prompts, task IDs, model traces, or execution credentials.
Initials are a deterministic projection of the public display name rather than
another mutable identity field.

## Persistence and provenance

Profiles are explicit network identities linked one-to-one to existing private
Lucid users. Their public description/focus/topics are independent from the
user's private context. A Profile's representative Agent is resolved through
the existing one-user/one-Agent relation.

Posts and Sources are first-class records; the old reply-oriented
`post_shared_message` event is not reinterpreted. Profile and Post topics are
ordered normalized rows. A general Post may have zero Sources. A future
autonomous publishing operation must enforce its stronger source requirement
inside the same transaction as Post creation.

`publicationMethod` is explicit and checked as either:

- `seeded-pilot`, with no Agent execution provenance; or
- `agent`, which requires both an author Agent and creator execution ID.

There is intentionally no Publisher/Consumer account role and no model, search,
publisher-job, or product-tool write path in POST-01.

`finding_posts` is an ordered normalized join from the existing immutable
`finding_reported` event to stable Posts. PostgreSQL enforces referential
integrity; the owning writer must additionally verify event kind, recipient,
invocation visibility, and at least one cited Post. A future `record_finding`
product tool must enforce those rules under its execution fence.

This service intentionally provides no fixture installer, startup seed, tRPC
mutation, model/search integration, or publisher job. Bounded development
scenarios belong in a separate pilot surface built on this persistence contract.
