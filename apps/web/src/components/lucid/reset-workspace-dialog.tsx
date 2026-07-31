import * as Dialog from '@radix-ui/react-dialog';
import { RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ResetWorkspaceDialogProps = {
  disabled: boolean;
  isPending: boolean;
  onReset(): void;
};

export function ResetWorkspaceDialog({
  disabled,
  isPending,
  onReset,
}: ResetWorkspaceDialogProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button disabled={disabled} size="small" variant="ghost">
          <RotateCcw size={14} />
          Reset workspace
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
          <p className="section-label">Destructive workspace action</p>
          <Dialog.Title>Reset this discovery workspace?</Dialog.Title>
          <Dialog.Description>
            Lucid will clear the saved interest, findings, feedback and event
            log. Running wakes will stop, and the current Heddle tasks,
            checkpoints and run history will be replaced with a clean
            workspace.
          </Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button variant="secondary">Keep workspace</Button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <Button
                disabled={isPending}
                onClick={onReset}
                variant="danger"
              >
                Reset workspace
              </Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
