export type LucidRequestRole = 'participant' | 'operator';

/** Verified upstream subject used only to resolve a durable Lucid identity. */
export type LucidExternalIdentity = {
  issuer: string;
  subject: string;
};

/** Identity established by the HTTP authentication adapter, never by input. */
export type LucidRequestPrincipal = {
  subject: string;
  externalIdentity?: LucidExternalIdentity;
  participantId?: string;
  roles: readonly LucidRequestRole[];
};

export function principalHasRole(
  principal: LucidRequestPrincipal | undefined,
  role: LucidRequestRole,
): boolean {
  return principal?.roles.includes(role) ?? false;
}
