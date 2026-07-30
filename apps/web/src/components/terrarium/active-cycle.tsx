import { LoaderCircle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TerrariumSnapshot } from '@/lib/trpc';

type ActiveCycleProps = {
  cycle: NonNullable<TerrariumSnapshot['activeCycle']>;
  isCancelling: boolean;
  onCancel(): void;
};

export function ActiveCycle({
  cycle,
  isCancelling,
  onCancel,
}: ActiveCycleProps) {
  return (
    <aside className="active-cycle" aria-live="polite">
      <span className="active-cycle__halo" aria-hidden="true" />
      <div className="active-cycle__icon">
        <LoaderCircle size={20} />
      </div>
      <div className="active-cycle__body">
        <p className="eyebrow">
          Wake {Math.min(cycle.completedSteps + 1, cycle.requestedSteps)}
          {' '}of {cycle.requestedSteps}
        </p>
        <strong>{cycle.dreamerName ?? 'Selecting a Dreamer'}</strong>
        <p>{cycle.latestActivity}</p>
      </div>
      <Button
        aria-label="Stop the active wake cycle"
        disabled={cycle.cancelRequested || isCancelling}
        onClick={onCancel}
        size="small"
        variant="ghost"
      >
        <Square size={13} />
        Stop
      </Button>
    </aside>
  );
}
