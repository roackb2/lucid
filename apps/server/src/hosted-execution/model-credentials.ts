import type {
  HostedConversationCredentialContext,
  HostedConversationModelCredentialProvider,
} from '@heddleagent/execution-host-client/conversation';
import { z } from 'zod';

const ModelApiKeySchema = z.string().trim().min(8).max(4_096);

/** Keeps one deployment-supplied model credential out of enumerable config. */
export class EnvironmentHostedModelCredentials
implements HostedConversationModelCredentialProvider {
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

  async resolveModelApiKey(
    context: HostedConversationCredentialContext,
  ): Promise<string> {
    context.signal?.throwIfAborted();
    return this.#modelApiKey;
  }
}
