# Information Network front-end preview

This folder owns the deterministic read model used to review Lucid's proposed
Information Network experience before the product has durable Posts, Sources,
Profiles, publishing jobs, or Publishing preferences.

## Boundary

- The preview models Lucid product concepts only. It does not model Heddle
  tasks, Runtime sessions, invocation IDs, prompts, or provider traces.
- Data is deterministic, read-only, and visibly labeled as prototype data.
- The preview repository projects normalized fixtures into feed, Post, Profile,
  and Network Lab views. React components consume those views through React
  Query, matching the application's eventual server-read pattern.
- Nothing in this folder is an accepted database schema or tRPC contract.

When the server owns first-class Information Network records, replace the
preview query functions with typed tRPC queries and delete this folder's
fixtures. Do not preserve a compatibility adapter merely for the prototype.
