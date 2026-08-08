import type {
  Participant,
  ParticipantView,
} from '../discovery-types.js';

/** Removes trusted-ingress identity and private context from product views. */
export function toParticipantView(
  participant: Participant,
): ParticipantView {
  const {
    privateContext: _privateContext,
    registrationKey: _registrationKey,
    ...view
  } = participant;
  return view;
}
