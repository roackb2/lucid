/**
 * Development-only people and observations for exercising a sparse Lucid
 * network. Nothing in this file is imported by the server or product client.
 */
export type NetworkScenario = {
  key: string;
  displayName: string;
  privateContext: string;
  inputs: readonly string[];
};

export const NETWORK_SCENARIOS = [
  {
    key: 'independent-product-builder',
    displayName: 'Independent product builder',
    privateContext:
      'You represent a small independent software builder. Share concrete observations from products, prototypes, and user conversations when another participant has a related need. Do not pretend your observations generalize beyond their stated context.',
    inputs: [
      'A tool I tested became much more useful when it remembered unfinished work instead of only storing polished outputs. The rough intermediate state was the valuable part.',
      'Three builders in a small meetup independently complained that their agents can execute tasks but cannot discover useful context held by people outside their own workspace.',
      'A prototype onboarding worked better when it asked for one active problem and returned one specific lead later, rather than asking users to configure an agent persona up front.',
    ],
  },
  {
    key: 'music-maker',
    displayName: 'Music maker',
    privateContext:
      'You represent someone experimenting with AI-assisted songwriting and production. Offer specific techniques, artifacts, or collaboration leads when relevant. Treat personal taste as taste, not universal quality.',
    inputs: [
      'Keeping discarded melody and arrangement versions has been more useful for teaching collaborators my taste than sharing prompt recipes.',
      'I found that asking a model to transform a rough vocal rhythm before generating lyrics preserves more of the writer’s intent than starting from a genre label.',
      'A producer I know is looking for ways to exchange small, reusable production decisions without publishing full project files.',
    ],
  },
  {
    key: 'community-organizer',
    displayName: 'Community organizer',
    privateContext:
      'You represent a local technology-community organizer. You notice who is exploring which problems and can surface possible introductions, but never invent relationships or disclose private details not present in your input.',
    inputs: [
      'Several recent meetup attendees are building local-first AI tools, but they describe themselves by the problem they are solving rather than by a shared technology label.',
      'People respond more often to a concrete introduction explaining why two current problems overlap than to a directory of profiles.',
      'One recurring complaint is that useful niche knowledge appears in small conversations and disappears before the right person knows to ask for it.',
    ],
  },
  {
    key: 'systems-engineer',
    displayName: 'Systems engineer',
    privateContext:
      'You represent an engineer working on reliable agent runtimes. Share implementation lessons, failure modes, and concrete tools when relevant. Distinguish observed behavior from speculation.',
    inputs: [
      'In a recent background-agent test, durable run requests mattered more than precise scheduling because several new inputs arrived while the agent was already busy.',
      'The hardest part of unattended agents has been making cancellation and retries preserve one causal input horizon, not making another agent call possible.',
      'Operator-wide diagnostic state was useful during development but confusing when exposed in the end-user product view.',
    ],
  },
] as const satisfies readonly NetworkScenario[];
