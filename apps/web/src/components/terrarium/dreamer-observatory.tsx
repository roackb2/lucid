import type { DreamerView } from '@/lib/trpc';
import { DreamerCard } from './dreamer-card';

type DreamerObservatoryProps = {
  dreamers: DreamerView[];
  activeDreamerId?: string;
  selectedDreamerId?: string;
  onSelectDreamer(id?: string): void;
};

export function DreamerObservatory({
  dreamers,
  activeDreamerId,
  selectedDreamerId,
  onSelectDreamer,
}: DreamerObservatoryProps) {
  return (
    <section className="observatory" aria-labelledby="observatory-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">The sleeping minds</p>
          <h2 id="observatory-title">Observatory</h2>
        </div>
        {selectedDreamerId ? (
          <button
            className="text-action"
            onClick={() => onSelectDreamer(undefined)}
            type="button"
          >
            Show all threads
          </button>
        ) : (
          <p>Choose a Dreamer to isolate their traces.</p>
        )}
      </div>
      <div className="dreamer-grid">
        {dreamers.map((dreamer) => (
          <DreamerCard
            dreamer={dreamer}
            isActive={activeDreamerId === dreamer.id}
            isSelected={selectedDreamerId === dreamer.id}
            key={dreamer.id}
            onSelect={() => onSelectDreamer(
              selectedDreamerId === dreamer.id ? undefined : dreamer.id,
            )}
          />
        ))}
      </div>
    </section>
  );
}
