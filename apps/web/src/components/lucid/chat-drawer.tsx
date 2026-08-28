import * as Dialog from '@radix-ui/react-dialog';
import {
  Eye,
  MessageCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  type ReactNode,
  useRef,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  HostedConversation,
  useHostedConversation,
} from '@/components/lucid/hosted-conversation';

export function ChatDrawer({ trigger }: { trigger: ReactNode }) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversation = useHostedConversation();

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="chat-drawer__overlay" />
        <Dialog.Content
          className="chat-drawer__content"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => composerRef.current?.focus());
          }}
        >
          <header className="chat-drawer__header">
            <div className="chat-drawer__title-row">
              <span className="chat-drawer__mark" aria-hidden="true">
                <MessageCircle />
              </span>
              <div>
                <Dialog.Title>Chat with Lucid</Dialog.Title>
                <Dialog.Description>
                  One conversation, saved for your account.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <Button aria-label="Close Chat" size="icon" variant="ghost">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <section
            aria-label="Chat access"
            className="chat-drawer__scope"
          >
            <span aria-hidden="true"><Eye /></span>
            <div>
              <strong>Read-only Lucid context</strong>
              <p>Current Interest, Agent understanding, Activity, and Findings.</p>
            </div>
            <span className="chat-drawer__runtime">
              <ShieldCheck aria-hidden="true" />
              AgentCore
            </span>
          </section>

          <HostedConversation
            composerRef={composerRef}
            controller={conversation}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
