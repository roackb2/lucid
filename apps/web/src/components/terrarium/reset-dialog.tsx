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
          <p className="eyebrow">Irreversible in this generation</p>
          <Dialog.Title>Let the current world dissolve?</Dialog.Title>
          <Dialog.Description>
            Lucid will clear this world ledger and give all three Dreamers new
            Heddle conversations. The files from older conversations remain on
            disk, but this interface will begin from a clean origin.
          </Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button variant="secondary">Keep this world</Button>
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
