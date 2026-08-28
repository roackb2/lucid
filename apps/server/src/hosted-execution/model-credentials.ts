import type {
  HostedConversationCredentialContext,
  HostedModelCredentialProvider,
} from '@heddleagent/execution-host-client/conversation';
import {
  RuntimeCredentialService,
} from '@heddleagent/runtime';
import { z } from 'zod';

const ModelApiKeySchema = z.string().trim().min(8).max(4_096);

/** Keeps one deployment-supplied model credential out of enumerable config. */
export class EnvironmentHostedModelCredentials
implements HostedModelCredentialProvider {
  readonly #modelApiKey: string;

  private constructor(modelApiKey: string) {
    this.#modelApiKey = ModelApiKeySchema.parse(modelApiKey);
  }

  /** Takes the credential out of the process environment before use. */
  static take(
    environment: NodeJS.ProcessEnv,
    name: string,
  ): EnvironmentHostedModelCredentials {
    const modelApiKey = environment[name];
    delete environment[name];
    return new EnvironmentHostedModelCredentials(modelApiKey ?? '');
  }

  async resolveModelCredential(
    context: HostedConversationCredentialContext,
  ) {
    context.signal?.throwIfAborted();
    return {
      type: 'api-key' as const,
      apiKey: this.#modelApiKey,
    };
  }
}

/**
 * Acquires one access-token-only Runtime credential from Lucid's Heddle state.
 * Refresh and persistence stay inside Heddle's credential service.
 */
export class HeddleStoredOAuthModelCredentials
implements HostedModelCredentialProvider {
  readonly #model: string;
  readonly #stateRoot: string;
  readonly #minimumValidityMs: number;

  constructor(
    model: string,
    stateRoot: string,
    minimumValidityMs: number,
  ) {
    this.#model = model;
    this.#stateRoot = stateRoot;
    this.#minimumValidityMs = minimumValidityMs;
  }

  async resolveModelCredential(
    context: HostedConversationCredentialContext,
  ) {
    const credential = await RuntimeCredentialService
      .acquireRequestScopedCredentialForModel(this.#model, {
        stateRoot: this.#stateRoot,
        refreshBeforeMs: this.#minimumValidityMs,
        signal: context.signal,
      });
    if (!credential) {
      throw new Error(
        'Lucid has no compatible Heddle account credential for hosted execution. Run Heddle OpenAI login for this Lucid state root and retry.',
      );
    }
    return credential;
  }
}
