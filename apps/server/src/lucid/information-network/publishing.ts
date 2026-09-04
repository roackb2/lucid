/** Domain validation and orchestration for source-backed Agent publication. */
import { z } from 'zod';
import type { InformationNetworkPublicationStore } from './store.js';
import type {
  PublishAgentTextPostReceipt,
  SourceBackedTextPostDraft,
} from './types.js';

export const PUBLISH_TEXT_POST_TOOL = 'publish_text_post';

const sourceUrlSchema = z.url()
  .max(2_048)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) {
      context.addIssue({
        code: 'custom',
        message: 'A Post source must use HTTP or HTTPS.',
      });
    }
    if (url.username || url.password) {
      context.addIssue({
        code: 'custom',
        message: 'A Post source URL cannot contain credentials.',
      });
    }
  })
  .transform((value) => new URL(value).href);

export const sourceBackedTextPostDraftSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20_000),
  topics: z.array(z.string().trim().min(1).max(120))
    .min(1)
    .max(8)
    .refine(hasUniqueCaseInsensitiveValues, {
      message: 'Post topics must be unique.',
    }),
  sources: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    sourceName: z.string().trim().min(1).max(200),
    url: sourceUrlSchema,
  }).strict())
    .min(1)
    .max(8)
    .refine(
      (sources) => hasUniqueCaseInsensitiveValues(
        sources.map(({ url }) => url),
      ),
      { message: 'Post source URLs must be unique.' },
    ),
}).strict();

export type PublishAgentTextPostInput = {
  userId: string;
  executionId: string;
  draft: unknown;
};

export class InformationNetworkPublishingInputError extends Error {
  readonly name = 'InformationNetworkPublishingInputError';

  constructor(message: string) {
    super(message);
  }
}

/** Publishes one normalized source-backed Post for a trusted Agent execution. */
export class InformationNetworkPublishingService {
  constructor(
    private readonly store: InformationNetworkPublicationStore,
  ) {}

  async publishTextPost(
    input: PublishAgentTextPostInput,
  ): Promise<PublishAgentTextPostReceipt> {
    const draft = parseDraft(input.draft);
    return await this.store.publishAgentTextPost({
      userId: input.userId,
      executionId: input.executionId,
    }, draft);
  }
}

function parseDraft(value: unknown): SourceBackedTextPostDraft {
  const parsed = sourceBackedTextPostDraftSchema.safeParse(value);
  if (!parsed.success) {
    throw new InformationNetworkPublishingInputError(
      parsed.error.issues[0]?.message ?? 'The Post draft is invalid.',
    );
  }
  return parsed.data;
}

function hasUniqueCaseInsensitiveValues(values: readonly string[]): boolean {
  return new Set(values.map((value) => value.toLowerCase())).size
    === values.length;
}
