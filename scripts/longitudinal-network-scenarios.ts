/**
 * Development-only episodes for testing whether one Lucid representative can
 * refine an ongoing assignment across real participant feedback. The phases
 * describe exogenous events; they never prescribe what the product agent must
 * conclude or whether the participant should value a finding.
 */
import type { LongitudinalNetworkPhase } from './network-simulator-core.js';

export const LONGITUDINAL_NETWORK_PHASES = [
  {
    key: 'setup',
    title: 'Prepare the participant network',
    purpose:
      'Register stable synthetic participants before the local representative publishes its first request. No participant input is submitted.',
    operatorInstruction:
      'Open Lucid and save the ongoing interest. Wait until its first network request is visible, then advance to baseline.',
    inputs: [],
  },
  {
    key: 'baseline',
    title: 'Initial outside-context leads',
    purpose:
      'Give the representative two plausible starting leads before the participant explains what is actually useful.',
    operatorInstruction:
      'Inspect any finding and leave your own feedback before advancing to refinement.',
    inputs: [
      {
        scenarioKey: 'independent-product-builder',
        content:
          'A builder originally asked new users to configure an agent persona. After a support lead described how unfinished handoffs disappeared between tools, the builder replaced persona setup with one active-problem prompt and a returning-work queue. The decision came from that conversation, not repository analytics.',
      },
      {
        scenarioKey: 'community-organizer',
        content:
          'At a local meetup, people ignored a directory of AI-builder profiles but responded to two introductions that named a current problem both sides were already working on. I observed the behavior, but did not collect enough follow-up to know which part of the introduction caused it.',
      },
    ],
  },
  {
    key: 'refinement',
    title: 'One concrete increment and one repetition',
    purpose:
      'Test whether the representative follows the participant correction, selects the concrete increment, and ignores a restatement.',
    operatorInstruction:
      'Run a check now so the revised direction reaches the network, inspect any new finding, and leave feedback before advancing to revision.',
    inputs: [
      {
        scenarioKey: 'systems-engineer',
        content:
          'An agent-runtime prototype first exposed a global task dashboard. After an operator explained that they only needed to know what their own representative retained, requested, and returned, the product changed to a participant-scoped inbox. The concrete mechanism was replacing task status rows with the saved assignment, disclosed request, sourced finding, and private feedback loop.',
      },
      {
        scenarioKey: 'community-organizer',
        content:
          'The same meetup still suggests that specific problem-based introductions work better than a general directory. I do not yet have a new mechanism or outcome beyond the earlier observation.',
      },
    ],
  },
  {
    key: 'revision',
    title: 'A correction plus unrelated noise',
    purpose:
      'Test whether the representative can report a material revision to an earlier lead while staying quiet about unrelated novelty.',
    operatorInstruction:
      'Run a check now, inspect whether the correction is reported without the unrelated technique, and leave any final feedback.',
    inputs: [
      {
        scenarioKey: 'independent-product-builder',
        content:
          'Follow-up interviews changed the onboarding conclusion. The active-problem prompt helped only when the product also restored the unfinished artifact on return; without that restoration, users described it as another intake form. The builder therefore kept the prompt but made durable unfinished work the primary product decision.',
      },
      {
        scenarioKey: 'music-maker',
        content:
          'A new vocal-processing experiment preserved consonant rhythm better when pitch correction happened after timing edits. This is a production technique and I have no evidence that it changes a software product or agent workflow.',
      },
    ],
  },
] as const satisfies readonly LongitudinalNetworkPhase[];
