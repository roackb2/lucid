import { LoaderCircle, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LucidSnapshot } from '@/lib/trpc';

type ActiveJourneyProps = {
  journey: NonNullable<LucidSnapshot['activeJourney']>;
  isCancelling: boolean;
  onCancel(): void;
};

const PHASE_LABELS = {
  seeking: 'Carrying your intent outward',
  responding: 'A peer is considering the encounter',
  returning: 'Deciding what deserves to come home',
} as const;

export function ActiveJourney({
  journey,
  isCancelling,
  onCancel,
}: ActiveJourneyProps) {
  const phaseLabel = journey.phase
    ? PHASE_LABELS[journey.phase]
    : 'Choosing the next representative';

  return (
    <aside className="active-journey" aria-live="polite">
      <span className="active-journey__halo" aria-hidden="true" />
      <div className="active-journey__icon">
        <LoaderCircle size={20} />
      </div>
      <div className="active-journey__body">
        <p className="eyebrow">
          Encounter {Math.min(journey.completedSteps + 1, journey.requestedSteps)}
          {' '}of {journey.requestedSteps}
        </p>
        <strong>{journey.agentName ?? phaseLabel}</strong>
        <p>{journey.latestActivity}</p>
      </div>
      <div className="active-journey__phase">
        <span>{phaseLabel}</span>
        <progress
          aria-label="Journey progress"
          max={journey.requestedSteps}
          value={journey.completedSteps}
        />
      </div>
      <Button
        aria-label="Call Aster home and stop the active journey"
        disabled={journey.cancelRequested || isCancelling}
        onClick={onCancel}
        size="small"
        variant="ghost"
      >
        <Square size={13} />
        Call home
      </Button>
    </aside>
  );
}
