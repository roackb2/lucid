/**
 * Explicit local-operator review boundary for one assisted participant's
 * private context. The sensitive response exists only while this dialog is
 * open; saving requires renewed consent and delegates settlement to the
 * backend before replacing context used by a representative agent.
 */
import * as Dialog from '@radix-ui/react-dialog';
import dayjs from 'dayjs';
import { ShieldCheck, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import type {
  AgentView,
  AssistedParticipantContext,
  UpdateAssistedParticipantContextInput,
} from '@/lib/trpc';

type ParticipantContextDialogProps = {
  agent: AgentView;
  context?: AssistedParticipantContext;
  isUpdating: boolean;
  onClose(): void;
  onUpdate(input: UpdateAssistedParticipantContextInput): Promise<unknown>;
};

export function ParticipantContextDialog({
  agent,
  context,
  isUpdating,
  onClose,
  onUpdate,
}: ParticipantContextDialogProps) {
  const [privateContext, setPrivateContext] = useState(
    context?.privateContext ?? '',
  );
  const [contextApproved, setContextApproved] = useState(false);
  const contextId = useId();
  const consentId = useId();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!context || !contextApproved || !privateContext.trim()) {
      return;
    }
    try {
      await onUpdate({
        participantId: context.id,
        privateContext,
        contextApproved: true,
      });
      onClose();
    } catch {
      // The mutation displays the server error and leaves the review open.
    }
  };

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open && !isUpdating) {
          onClose();
        }
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content dialog-content--participant">
          <Dialog.Close asChild>
            <button
              aria-label="Close"
              className="dialog-close"
              disabled={isUpdating}
              type="button"
            >
              <X size={18} />
            </button>
          </Dialog.Close>
          <p className="section-label">Participant consent and context</p>
          <Dialog.Title>Review {agent.participant.displayName}</Dialog.Title>
          <Dialog.Description>
            Review the exact private text with this participant. Their agent
            may use it to decide relevance and share the smallest necessary
            detail with other representatives. Saving records renewed consent;
            withdrawing permanently scrubs the context through the participant
            action in the source list.
          </Dialog.Description>

          {context ? (
            <form className="participant-form" onSubmit={handleSubmit}>
              <p className="participant-context-meta">
                Last approved {context.contextConsentAt
                  ? dayjs(context.contextConsentAt).format('MMM D, YYYY HH:mm')
                  : 'before consent timestamps were recorded'} · {context.status}
              </p>

              <label htmlFor={contextId}>Approved private context</label>
              <textarea
                disabled={isUpdating}
                id={contextId}
                maxLength={4_000}
                onChange={(event) => setPrivateContext(event.target.value)}
                required
                rows={8}
                value={privateContext}
              />
              <small>{privateContext.length.toLocaleString()} / 4,000</small>

              <label className="participant-consent" htmlFor={consentId}>
                <input
                  checked={contextApproved}
                  disabled={isUpdating}
                  id={consentId}
                  onChange={(event) => setContextApproved(event.target.checked)}
                  required
                  type="checkbox"
                />
                <span>
                  <ShieldCheck size={16} />
                  This person reviewed the text above and renewed permission
                  for their agent to use it and share minimal relevant details.
                </span>
              </label>

              <div className="dialog-actions">
                <Button
                  disabled={isUpdating}
                  onClick={onClose}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={
                    isUpdating
                    || !contextApproved
                    || !privateContext.trim()
                  }
                  type="submit"
                >
                  <ShieldCheck size={14} />
                  {isUpdating ? 'Saving…' : 'Save renewed context'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="participant-context-loading" aria-live="polite">
              Loading the approved context for explicit review…
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
