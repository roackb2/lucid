import {
  Message,
  MessageContent,
} from '@/components/ai-elements/message';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { HostedConversationTurn } from '@/lib/trpc';

/** Safe shared renderer for live and durable public agent summaries. */
export function HostedConversationAnswer({
  markdown,
  status,
}: {
  markdown: string;
  status: HostedConversationTurn['status'];
}) {
  return (
    <div className="hosted-conversation-answer" data-status={status}>
      <Message from="assistant">
        <MessageContent>
          <span className="hosted-conversation-answer__speaker">Agent</span>
          <ReactMarkdown
            components={{
              a: ({ children, ...properties }) => (
                <a
                  {...properties}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {children}
                </a>
              ),
              img: () => null,
            }}
            disallowedElements={['img']}
            remarkPlugins={[remarkGfm]}
            skipHtml
          >
            {markdown}
          </ReactMarkdown>
        </MessageContent>
      </Message>
    </div>
  );
}
