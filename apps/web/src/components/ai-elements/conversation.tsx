import { ArrowDown } from 'lucide-react';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
} from 'react';
import {
  StickToBottom,
  useStickToBottomContext,
} from 'use-stick-to-bottom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Scoped adaptation of the official AI Elements Conversation registry item. */
export function Conversation({
  className,
  ...properties
}: ComponentProps<typeof StickToBottom>) {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...properties}
    />
  );
}
export function ConversationContent({
  className,
  ...properties
}: ComponentProps<typeof StickToBottom.Content>) {
  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-8 p-4', className)}
      {...properties}
    />
  );
}

export function ConversationEmptyState({
  children,
  className,
  description = 'Start a conversation to see messages here.',
  icon,
  title = 'No messages yet',
  ...properties
}: ComponentProps<'div'> & {
  description?: string;
  icon?: ReactNode;
  title?: string;
}) {
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
      {...properties}
    >
      {children ?? (
        <>
          {icon ? <div>{icon}</div> : null}
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

export function ConversationScrollButton({
  className,
  ...properties
}: ComponentProps<typeof Button>) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) {
    return null;
  }

  return (
    <Button
      aria-label="Scroll to latest message"
      className={cn('chat-thread__scroll-button', className)}
      onClick={handleScrollToBottom}
      size="icon"
      type="button"
      variant="secondary"
      {...properties}
    >
      <ArrowDown aria-hidden="true" />
    </Button>
  );
}
