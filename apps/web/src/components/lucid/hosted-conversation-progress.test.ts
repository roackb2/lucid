import { describe, expect, it } from 'vitest';
import {
  mergeHostedConversationProgress,
  presentHostedConversationActivity,
} from './hosted-conversation-progress';

describe('hosted conversation progress presentation', () => {
  it('distinguishes product reads, web searches, and completed tool calls', () => {
    expect(presentHostedConversationActivity({
      type: 'tool.calling',
      tool: 'product__read_workspace_snapshot',
      toolCallId: 'workspace-1',
      input: { private: 'must not be projected' },
    })).toEqual({
      status: 'Reading your Lucid workspace',
      progress: {
        id: 'tool:workspace-1',
        text: 'Reading your Lucid workspace',
        kind: 'tool',
        done: false,
      },
    });
    expect(presentHostedConversationActivity({
      type: 'tool.completed',
      tool: 'web_search',
      toolCallId: 'search-1',
      result: { private: 'must not be projected' },
    })).toEqual({
      status: 'Finished searching the web',
      progress: {
        id: 'tool:search-1',
        text: 'Finished searching the web',
        kind: 'tool',
        done: true,
      },
    });
  });

  it('projects only bounded user-facing narration', () => {
    const presentation = presentHostedConversationActivity({
      type: 'assistant.commentary',
      messageId: 'commentary-1',
      text: `  ${'a'.repeat(5_000)}  `,
      hidden: 'not rendered',
      done: false,
    });

    expect(presentation.status).toBe('Agent is sharing progress');
    expect(presentation.progress).toMatchObject({
      id: 'commentary:commentary-1',
      kind: 'commentary',
      done: false,
    });
    expect(presentation.progress?.text).toHaveLength(1_200);
    expect(JSON.stringify(presentation)).not.toContain('not rendered');
  });

  it('updates streamed narration and tool completion in place', () => {
    const initial = [{
      id: 'reasoning:step-1',
      text: 'Checking sources',
      kind: 'reasoning' as const,
      done: false,
    }];

    expect(mergeHostedConversationProgress(initial, {
      id: 'reasoning:step-1',
      text: 'Checking sources and comparing dates',
      kind: 'reasoning',
      done: true,
    })).toEqual([{
      id: 'reasoning:step-1',
      text: 'Checking sources and comparing dates',
      kind: 'reasoning',
      done: true,
    }]);
  });

  it('bounds progress retained by long-running turns', () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      id: `tool:${index}`,
      text: `Tool ${index}`,
      kind: 'tool' as const,
      done: true,
    })).reduce(mergeHostedConversationProgress, []);

    expect(items).toHaveLength(12);
    expect(items[0]?.id).toBe('tool:18');
    expect(items.at(-1)?.id).toBe('tool:29');
  });
});
