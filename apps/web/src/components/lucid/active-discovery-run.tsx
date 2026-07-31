import { LoaderCircle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';

type ActiveDiscoveryRunProps = {
  run: NonNullable<DiscoverySnapshot['activeRun']>;
  isCancelling: boolean;
  onCancel(): void;
};

const PHASE_LABELS = {
  requesting: 'Preparing a request for participant agents',
  responding: 'Checking a participant source',
  reporting: 'Reviewing possible findings',
} as const;

export function ActiveDiscoveryRun({
  run,
  isCancelling,
  onCancel,
}: ActiveDiscoveryRunProps) {
  const currentStep = Math.min(run.completedSteps + 1, run.totalSteps);
  const phaseLabel = run.phase
    ? PHASE_LABELS[run.phase]
    : 'Moving to the next participant';

  return (
    <section className="active-run" aria-live="polite">
      <div className="active-run__icon" aria-hidden="true">
        <LoaderCircle size={19} />
      </div>
      <div className="active-run__summary">
        <div>
          <strong>Discovery check in progress</strong>
          <span>Step {currentStep} of {run.totalSteps}</span>
        </div>
        <p>{phaseLabel}</p>
        <small>{run.latestActivity}</small>
      </div>
      <progress
        aria-label="Discovery check progress"
        max={run.totalSteps}
        value={run.completedSteps}
      />
      <Button
        aria-label="Stop the active discovery check"
        disabled={run.cancelRequested || isCancelling}
        onClick={onCancel}
        size="small"
        variant="ghost"
      >
        <Square size={13} />
        Stop
      </Button>
    </section>
  );
}
