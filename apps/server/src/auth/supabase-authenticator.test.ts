import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import type { FetchImplementation } from 'jose';
import type { ParticipantIdentityReader } from '../lucid/network/store.js';
import { createSupabaseAuthenticator } from './supabase-authenticator.js';

const PROJECT_URL = 'https://project-ref.supabase.co';
const ISSUER = `${PROJECT_URL}/auth/v1`;
const OPERATOR_TOKEN = 'operator-token-with-at-least-thirty-two-characters';

describe('Supabase request authentication', () => {
  it('resolves a verified provider subject through Lucid product identity', async () => {
    const fixture = await createJwtFixture();
    const resolveParticipantIdentity = vi.fn(async () => ({
      participantId: 'participant_avery',
      status: 'active' as const,
    }));
    const authenticator = createAuthenticator(
      fixture.fetch,
      { resolveParticipantIdentity },
    );

    const token = await fixture.sign({ subject: 'subject-avery' });
    await expect(authenticator.authenticate({
      authorization: `Bearer ${token}`,
    })).resolves.toEqual({
      subject: `${ISSUER}:subject-avery`,
      externalIdentity: { issuer: ISSUER, subject: 'subject-avery' },
      participantId: 'participant_avery',
      roles: ['participant'],
    });
    expect(resolveParticipantIdentity).toHaveBeenCalledWith({
      issuer: ISSUER,
      subject: 'subject-avery',
    });
  });

  it('keeps a valid but unbound subject outside product authorization', async () => {
    const fixture = await createJwtFixture();
    const authenticator = createAuthenticator(fixture.fetch, {
      resolveParticipantIdentity: async () => undefined,
    });

    await expect(authenticator.authenticate({
      authorization: `Bearer ${await fixture.sign({ subject: 'new-user' })}`,
    })).resolves.toMatchObject({
      externalIdentity: { issuer: ISSUER, subject: 'new-user' },
      roles: [],
    });
  });

  it('rejects invalid audience and anonymous sessions before identity lookup', async () => {
    const fixture = await createJwtFixture();
    const resolveParticipantIdentity = vi.fn(async () => undefined);
    const authenticator = createAuthenticator(
      fixture.fetch,
      { resolveParticipantIdentity },
    );

    await expect(authenticator.authenticate({
      authorization: `Bearer ${await fixture.sign({
        subject: 'wrong-audience',
        audience: 'service_role',
      })}`,
    })).resolves.toBeUndefined();
    await expect(authenticator.authenticate({
      authorization: `Bearer ${await fixture.sign({
        subject: 'anonymous',
        anonymous: true,
      })}`,
    })).resolves.toBeUndefined();
    expect(resolveParticipantIdentity).not.toHaveBeenCalled();
  });

  it('retains a separate break-glass operator credential', async () => {
    const fixture = await createJwtFixture();
    const authenticator = createAuthenticator(fixture.fetch, {
      resolveParticipantIdentity: async () => undefined,
    });

    await expect(authenticator.authenticate({
      authorization: `Bearer ${OPERATOR_TOKEN}`,
    })).resolves.toMatchObject({
      participantId: 'local-user',
      roles: ['participant', 'operator'],
    });
  });
});

function createAuthenticator(
  fetch: FetchImplementation,
  identities: ParticipantIdentityReader,
) {
  return createSupabaseAuthenticator({
    mode: 'supabase',
    projectUrl: PROJECT_URL,
    operatorToken: OPERATOR_TOKEN,
    allowSelfEnrollment: true,
  }, identities, { fetch });
}

async function createJwtFixture() {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  const fetch = vi.fn<FetchImplementation>(async () => new Response(
    JSON.stringify({ keys: [{ ...publicJwk, alg: 'ES256', kid: 'test-key' }] }),
    { headers: { 'content-type': 'application/json' } },
  ));
  return {
    fetch,
    sign: async (input: {
      subject: string;
      audience?: string;
      anonymous?: boolean;
    }) => new SignJWT({
      role: 'authenticated',
      is_anonymous: input.anonymous ?? false,
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setAudience(input.audience ?? 'authenticated')
      .setSubject(input.subject)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey),
  };
}
