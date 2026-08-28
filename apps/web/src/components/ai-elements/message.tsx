import {
  type HTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

/**
 * Lucid's scoped adaptation of the official AI Elements Message registry item.
 * It retains only the message and Markdown primitives used by the Chat drawer.
 */
export function Message({
  className,
  from,
  ...properties
}: HTMLAttributes<HTMLDivElement> & {
  from: 'assistant' | 'user';
}) {
  return (
    <div
      className={cn(
        'group flex w-full max-w-[95%] flex-col gap-2',
        from === 'user'
          ? 'is-user ml-auto justify-end'
          : 'is-assistant',
        className,
      )}
      {...properties}
    />
  );
}

export function MessageContent({
  children,
  className,
  ...properties
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm',
        'group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3',
        className,
      )}
      {...properties}
    >
      {children}
    </div>
  );
}
