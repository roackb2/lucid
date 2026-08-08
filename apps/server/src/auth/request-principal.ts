export type LucidRequestRole = 'participant' | 'operator';

/** Identity established by the HTTP authentication adapter, never by input. */
export type LucidRequestPrincipal = {
  subject: string;
  participantId?: string;
  roles: readonly LucidRequestRole[];
};

export function principalHasRole(
  principal: LucidRequestPrincipal | undefined,
  role: LucidRequestRole,
): boolean {
  return principal?.roles.includes(role) ?? false;
}
