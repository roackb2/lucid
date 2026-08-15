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
      <span>Agent</span>
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
        }}
        disallowedElements={['img']}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
