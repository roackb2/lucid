import type {
  User,
  UserView,
} from '../discovery-types.js';

/** Removes trusted-ingress identity and private context from product views. */
export function toUserView(
  user: User,
): UserView {
  const {
    privateContext: _privateContext,
    registrationKey: _registrationKey,
    ...view
  } = user;
  return view;
}
