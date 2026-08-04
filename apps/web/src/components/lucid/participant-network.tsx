/**
 * Operator UI for participant intake and lifecycle controls.
 * It gathers explicit context approval and renders server-owned state, while
 * all consent validation, mailbox cutoffs, task changes, and context scrubbing
 * remain enforced by the backend.
 */
import * as Dialog from '@radix-ui/react-dialog';
import dayjs from 'dayjs';
import {
  Bot,
  CircleAlert,
  CirclePause,
  CirclePlay,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  useId,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { ParticipantContextDialog } from './participant-context-dialog';
import type {
  AgentView,
  AssistedParticipantContext,
  CreateAssistedParticipantInput,
  DiscoverySnapshot,
  UpdateAssistedParticipantContextInput,
} from '@/lib/trpc';

type ParticipantNetworkProps = {
  agents: AgentView[];
  tasks: DiscoverySnapshot['backgroundChecks']['tasks'];
  isCreating: boolean;
  isPausingSimulated: boolean;
  isUpdatingContext: boolean;
  isUpdating: boolean;
  onCreate(input: CreateAssistedParticipantInput): Promise<unknown>;
  onLoadContext(participantId: string): Promise<AssistedParticipantContext>;
  onPauseSimulated(): Promise<unknown>;
  onRetire(participantId: string): Promise<unknown>;
  onSetEnabled(participantId: string, enabled: boolean): Promise<unknown>;
  onUpdateContext(
    input: UpdateAssistedParticipantContextInput,
  ): Promise<unknown>;
};

export function ParticipantNetwork({
  agents,
  tasks,
  isCreating,
  isPausingSimulated,
  isUpdatingContext,
  isUpdating,
  onCreate,
  onLoadContext,
  onPauseSimulated,
  onRetire,
  onSetEnabled,
  onUpdateContext,
}: ParticipantNetworkProps) {
  const [contextReview, setContextReview] = useState<{
    agent: AgentView;
    context?: AssistedParticipantContext;
  }>();
  const sourceAgents = agents.filter(
    (agent) => !agent.isUserAgent && agent.participant.status !== 'retired',
  );
  const taskByAgentId = new Map(tasks.map((task) => [task.agentId, task]));
  const activeRealSources = sourceAgents.filter((agent) => (
    agent.participant.kind === 'human'
    && agent.participant.status === 'active'
  ));
  const activeSimulatedSources = sourceAgents.filter((agent) => (
    agent.participant.kind === 'synthetic'
    && agent.participant.status === 'active'
  ));

  const openContextReview = async (agent: AgentView) => {
    setContextReview({ agent });
    try {
      const context = await onLoadContext(agent.participant.id);
      setContextReview((current) => (
        current?.agent.id === agent.id ? { agent, context } : current
      ));
    } catch {
      setContextReview(undefined);
    }
  };

  return (
    <section
      className="participant-network"
      aria-labelledby="participant-network-title"
      id="sources"
    >
      <header className="participant-network__header">
        <span className="participant-network__icon" aria-hidden="true">
          <Users size={19} />
        </span>
        <div>
          <p className="section-label">Participant network</p>
          <h2 id="participant-network-title">Who Lucid can ask</h2>
          <p>
            Each person or fixture has one representative agent and a private
            mailbox. Add a real person only with context they knowingly
            approved for this experiment.
          </p>
        </div>
        <AddParticipantDialog
          disabled={isUpdating}
          isPending={isCreating}
          onCreate={onCreate}
        />
      </header>

      {sourceAgents.length ? (
        <ul className="participant-list">
          {sourceAgents.map((agent) => {
            const active = agent.participant.status === 'active';
            const task = taskByAgentId.get(agent.id);
            const pending = (
              isCreating
              || isUpdating
              || isPausingSimulated
              || isUpdatingContext
            );
            return (
              <li key={agent.id}>
                <span
                  className="participant-avatar"
                  style={{ backgroundColor: agent.color }}
                  aria-hidden="true"
                >
                  {agent.participant.kind === 'human'
                    ? <UserRound size={17} />
                    : <Bot size={17} />}
                </span>
                <div className="participant-list__identity">
                  <div>
                    <strong>{agent.participant.displayName}</strong>
                    <span className={
                      agent.participant.kind === 'human'
                        ? 'source-badge source-badge--real'
                        : 'source-badge'
                    }>
                      {agent.participant.kind === 'human'
                        ? 'Real · assisted'
                        : 'Simulated fixture'}
                    </span>
                  </div>
                  <small>
                    {agent.role}
                    {agent.participant.contextConsentAt
                      ? ` · context approved ${dayjs(
                          agent.participant.contextConsentAt,
                        ).format('MMM D')}`
                      : ''}
                  </small>
                </div>
                <div className="participant-list__state">
                  <span className={active ? 'source-state source-state--active' : 'source-state'}>
                    {active ? 'Active' : 'Paused'}
                  </span>
                  <small>
                    {active
                      ? task?.status === 'running' ? 'Checking now' : 'Mailbox scheduled'
                      : 'New messages are skipped'}
                  </small>
                </div>
                <div className="participant-list__actions">
                  {agent.participant.kind === 'human' ? (
                    <Button
                      disabled={pending || isUpdatingContext}
                      onClick={() => {
                        void openContextReview(agent);
                      }}
                      size="small"
                      variant="ghost"
                    >
                      <ShieldCheck size={14} />
                      Review context
                    </Button>
                  ) : null}
                  <Button
                    disabled={pending}
                    onClick={() => onSetEnabled(agent.participant.id, !active)}
                    size="small"
                    variant="secondary"
                  >
                    {active
                      ? <CirclePause size={14} />
                      : <CirclePlay size={14} />}
                    {active ? 'Pause' : 'Resume'}
                  </Button>
                  <RetireParticipantDialog
                    agent={agent}
                    disabled={pending}
                    onRetire={onRetire}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="participant-network__empty">
          <Users size={20} />
          <p>No sources are available. Add one assisted participant to begin.</p>
        </div>
      )}

      {activeRealSources.length > 0 && activeSimulatedSources.length > 0 ? (
        <div className="participant-network__mix-warning">
          <CircleAlert size={18} aria-hidden="true" />
          <div>
            <strong>Real and simulated sources are mixed</strong>
            <p>
              Pause the fixtures before judging a real-person result, so sample
              messages cannot be mistaken for evidence from your participant.
            </p>
          </div>
          <Button
            disabled={isPausingSimulated || isUpdating}
            onClick={() => {
              void onPauseSimulated();
            }}
            size="small"
            variant="secondary"
          >
            <CirclePause size={14} />
            {isPausingSimulated ? 'Pausing…' : 'Pause simulated sources'}
          </Button>
        </div>
      ) : null}

      <footer className="participant-network__note">
        Pausing a source stops its task and skips messages sent while paused.
        Withdrawing a real source or retiring a fixture permanently removes
        private context while preserving non-sensitive historical attribution.
      </footer>

      {contextReview ? (
        <ParticipantContextDialog
          agent={contextReview.agent}
          context={contextReview.context}
          isUpdating={isUpdatingContext}
          key={`${contextReview.agent.id}:${contextReview.context?.contextConsentAt ?? 'loading'}`}
          onClose={() => setContextReview(undefined)}
          onUpdate={onUpdateContext}
        />
      ) : null}
    </section>
  );
}

type AddParticipantDialogProps = {
  disabled: boolean;
  isPending: boolean;
  onCreate(input: CreateAssistedParticipantInput): Promise<unknown>;
};

function AddParticipantDialog({
  disabled,
  isPending,
  onCreate,
}: AddParticipantDialogProps) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [privateContext, setPrivateContext] = useState('');
  const [contextApproved, setContextApproved] = useState(false);
  const nameId = useId();
  const contextId = useId();
  const consentId = useId();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contextApproved) {
      return;
    }
    try {
      await onCreate({
        displayName,
        privateContext,
        contextApproved: true,
      });
      setDisplayName('');
      setPrivateContext('');
      setContextApproved(false);
      setOpen(false);
    } catch {
      // The mutation displays the server error and leaves the form available.
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button disabled={disabled} size="small">
          <Plus size={14} />
          Add participant
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content dialog-content--participant">
          <Dialog.Close asChild>
            <button className="dialog-close" type="button" aria-label="Close">
              <X size={18} />
            </button>
          </Dialog.Close>
          <p className="section-label">Assisted participant intake</p>
          <Dialog.Title>Add one real source</Dialog.Title>
          <Dialog.Description>
            You are operating this participant’s agent. The full text stays in
            local SQLite and is shown only to their representative and during
            explicit operator review. Their agent may share or paraphrase the
            smallest relevant detail to other agents. Those messages remain
            inspectable in Lucid. They can later review, replace, or withdraw
            this context. This storage is not encrypted at rest.
          </Dialog.Description>

          <form className="participant-form" onSubmit={handleSubmit}>
            <label htmlFor={nameId}>Participant name</label>
            <input
              autoComplete="off"
              disabled={isPending}
              id={nameId}
              maxLength={80}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Avery"
              required
              value={displayName}
            />

            <label htmlFor={contextId}>Approved private context</label>
            <textarea
              disabled={isPending}
              id={contextId}
              maxLength={4_000}
              onChange={(event) => setPrivateContext(event.target.value)}
              placeholder="What do they know, like, need, or want their agent to notice? Use ordinary language."
              required
              rows={7}
              value={privateContext}
            />
            <small>{privateContext.length.toLocaleString()} / 4,000</small>

            <label className="participant-consent" htmlFor={consentId}>
              <input
                checked={contextApproved}
                disabled={isPending}
                id={consentId}
                onChange={(event) => setContextApproved(event.target.checked)}
                required
                type="checkbox"
              />
              <span>
                <ShieldCheck size={16} />
                This person reviewed this text and approved their agent using
                it and sharing minimal relevant details inside this experiment.
              </span>
            </label>

            <div className="dialog-actions">
              <Dialog.Close asChild>
                <Button disabled={isPending} type="button" variant="secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button disabled={isPending || !contextApproved} type="submit">
                <Plus size={14} />
                {isPending ? 'Adding…' : 'Add participant'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

type RetireParticipantDialogProps = {
  agent: AgentView;
  disabled: boolean;
  onRetire(participantId: string): Promise<unknown>;
};

function RetireParticipantDialog({
  agent,
  disabled,
  onRetire,
}: RetireParticipantDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isAssistedParticipant = agent.participant.kind === 'human';
  const actionCopy = isAssistedParticipant
    ? {
        label: 'Consent withdrawal',
        title: `Withdraw ${agent.participant.displayName} from Lucid?`,
        description:
          'Their agent will stop, their approved private context will be permanently scrubbed, and future messages will no longer reach them. Existing messages keep only the participant name so earlier findings remain understandable.',
        trigger: 'Withdraw',
        pending: 'Withdrawing…',
        confirm: 'Withdraw and scrub context',
      }
    : {
        label: 'Permanent participant action',
        title: `Retire ${agent.participant.displayName}?`,
        description:
          'The fixture task will be removed. Existing messages keep the fixture name so earlier findings remain understandable. Resetting the entire workspace is the only way to restore it.',
        trigger: 'Retire',
        pending: 'Retiring…',
        confirm: 'Retire fixture',
      };

  const handleRetire = async () => {
    setPending(true);
    try {
      await onRetire(agent.participant.id);
      setOpen(false);
    } catch {
      // The mutation displays the server error and leaves confirmation open.
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          disabled={disabled}
          size="small"
          variant="ghost"
        >
          <Trash2 size={14} />
          {actionCopy.trigger}
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
          <p className="section-label">{actionCopy.label}</p>
          <Dialog.Title>{actionCopy.title}</Dialog.Title>
          <Dialog.Description>{actionCopy.description}</Dialog.Description>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <Button disabled={pending} variant="secondary">
                Keep participant
              </Button>
            </Dialog.Close>
            <Button
              disabled={pending}
              onClick={handleRetire}
              variant="danger"
            >
              <Trash2 size={14} />
              {pending ? actionCopy.pending : actionCopy.confirm}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
