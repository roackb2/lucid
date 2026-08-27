import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUp, MessageCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

type CoworkDrawerProps = {
  context: string;
  trigger: ReactNode;
};

export function CoworkDrawer({ context, trigger }: CoworkDrawerProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="cowork-drawer__overlay" />
        <Dialog.Content className="cowork-drawer__content">
          <header className="cowork-drawer__header">
            <div className="cowork-drawer__title-row">
              <span className="cowork-drawer__mark" aria-hidden="true">
                <MessageCircle />
              </span>
              <div>
                <Dialog.Title>Cowork with your agent</Dialog.Title>
                <Dialog.Description>
                  Work together now, or leave the agent to continue later.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <Button aria-label="Close Cowork panel" size="icon" variant="ghost">
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </header>

          <div className="cowork-drawer__body">
            <section className="cowork-drawer__context" aria-label="Cowork context">
              <span>Context</span>
              <strong>{context}</strong>
            </section>

            <section className="cowork-drawer__empty">
              <span className="foundation-status">Not yet populated</span>
              <h2>The conversation belongs here, not at the bottom of a page.</h2>
              <p>
                This drawer reserves a stable place for interactive work while
                keeping reports and findings visible underneath. Conversation
                history, streaming, and context selection will be connected in
                a later product slice.
              </p>
            </section>
          </div>

          <footer className="cowork-drawer__composer">
            <label htmlFor="cowork-preview">Interactive prompt</label>
            <div className="cowork-drawer__composer-frame">
              <textarea
                disabled
                id="cowork-preview"
                placeholder="Ask, correct, or assign a follow-up…"
                rows={3}
              />
              <Button
                aria-label="Send prompt (not connected yet)"
                disabled
                size="icon"
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
            <small>Preview only · the agent is not contacted from this frame.</small>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
