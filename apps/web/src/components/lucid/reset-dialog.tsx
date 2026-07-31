import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ResetDialogProps = {
  disabled: boolean;
  isPending: boolean;
  onReset(): void;
};

export function ResetDialog({
  disabled,
  isPending,
  onReset,
}: ResetDialogProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button disabled={disabled} size="small" variant="ghost">
          <RotateCcw size={14} />
          New generation
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <Dialog.Close asChild>
            <button className="dialog-close" type="button" aria-label="Close">
              <X size={18} />
            </button>
          </Dialog.Close>
          <p className="eyebrow">Clear the active laboratory</p>
          <Dialog.Title>Begin a new First Return generation?</Dialog.Title>
          <Dialog.Description>
            Lucid will clear this generation’s principals, agents, returns and
            ledger, then assign new Heddle conversations. Older Heddle files
            remain on disk for inspection.
          </Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button variant="secondary">Keep this generation</Button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <Button
                disabled={isPending}
                onClick={onReset}
                variant="danger"
              >
                Begin again
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
