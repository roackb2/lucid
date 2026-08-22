import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const ServiceTokenSchema = z.string().trim().min(32).max(4_096);

/** Verifier credential scoped to coordinator calls into Lucid delegation. */
export class HostedHeartbeatDelegationCredentials {
  readonly #tokenDigest: Buffer;

  private constructor(token: string) {
    this.#tokenDigest = digest(ServiceTokenSchema.parse(token));
  }

  static takeOptional(
    environment: NodeJS.ProcessEnv,
    name: string,
  ): HostedHeartbeatDelegationCredentials | undefined {
    const token = environment[name];
    delete environment[name];
    return token?.trim()
      ? new HostedHeartbeatDelegationCredentials(token)
      : undefined;
  }

  authenticates(authorization: string | undefined): boolean {
    const token = /^Bearer ([^\s]+)$/i.exec(authorization?.trim() ?? '')?.[1];
    return token
      ? timingSafeEqual(digest(token), this.#tokenDigest)
      : false;
  }
}

/** Caller credential scoped to Lucid's task API calls into the coordinator. */
export class HostedHeartbeatCoordinatorApiCredentials {
  readonly #token: string;

  private constructor(token: string) {
    this.#token = ServiceTokenSchema.parse(token);
  }

  static takeOptional(
    environment: NodeJS.ProcessEnv,
    name: string,
  ): HostedHeartbeatCoordinatorApiCredentials | undefined {
    const token = environment[name];
    delete environment[name];
    return token?.trim()
      ? new HostedHeartbeatCoordinatorApiCredentials(token)
      : undefined;
  }

  authorizationHeader(): string {
    return `Bearer ${this.#token}`;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
