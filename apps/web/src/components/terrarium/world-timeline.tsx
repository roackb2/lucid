import {
  Archive,
  CircleAlert,
  Eye,
  Feather,
  LockKeyhole,
  MessageCircle,
  Moon,
  Radio,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import dayjs from 'dayjs';
import type { CSSProperties } from 'react';
import type {
  DreamerView,
  TerrariumEvent,
} from '@/lib/trpc';

type WorldTimelineProps = {
  dreamers: DreamerView[];
  events: TerrariumEvent[];
  selectedDreamerId?: string;
};

type EventPresentation = {
  icon: LucideIcon;
  label: string;
  privacy: 'world' | 'operator' | 'whisper';
};

const EVENT_PRESENTATION: Record<TerrariumEvent['kind'], EventPresentation> = {
  origin: { icon: Sparkles, label: 'Origin', privacy: 'world' },
  seed: { icon: Feather, label: 'Operator seed', privacy: 'world' },
  wake: { icon: Radio, label: 'Wake', privacy: 'operator' },
  post: { icon: MessageCircle, label: 'Commons', privacy: 'world' },
  message: { icon: LockKeyhole, label: 'Whisper', privacy: 'whisper' },
  belief: { icon: Eye, label: 'Belief', privacy: 'operator' },
  rest: { icon: Moon, label: 'Rest', privacy: 'operator' },
  reflection: { icon: Archive, label: 'Reflection', privacy: 'operator' },
  error: { icon: CircleAlert, label: 'System', privacy: 'operator' },
};

export function WorldTimeline({
  dreamers,
  events,
  selectedDreamerId,
}: WorldTimelineProps) {
  const dreamersById = new Map(dreamers.map((dreamer) => [dreamer.id, dreamer]));
  const visibleEvents = events
    .filter((event) => !selectedDreamerId
      || event.actorDreamerId === selectedDreamerId
      || event.targetDreamerId === selectedDreamerId)
    .toReversed();
  const selectedDreamer = selectedDreamerId
    ? dreamersById.get(selectedDreamerId)
    : undefined;

  return (
    <section className="world-ledger" aria-labelledby="ledger-title">
      <div className="section-heading ledger-heading">
        <div>
          <p className="eyebrow">Causal, inspectable, append-only</p>
          <h2 id="ledger-title">World ledger</h2>
        </div>
        <p>
          {selectedDreamer
            ? `Threads touching ${selectedDreamer.name}`
            : `${events.length} recent events`}
        </p>
      </div>

      <div className="privacy-key" aria-label="Event visibility legend">
        <span><i className="privacy-world" /> all Dreamers</span>
        <span><i className="privacy-whisper" /> recipient only</span>
        <span><i className="privacy-operator" /> operator only</span>
      </div>

      {visibleEvents.length ? (
        <ol className="timeline">
          {visibleEvents.map((event) => (
            <TimelineEvent
              dreamersById={dreamersById}
              event={event}
              key={event.id}
            />
          ))}
        </ol>
      ) : (
        <div className="empty-ledger">
          <Moon size={24} />
          <p>No thread touches this Dreamer yet.</p>
        </div>
      )}
    </section>
  );
}

type TimelineEventProps = {
  dreamersById: Map<string, DreamerView>;
  event: TerrariumEvent;
};

function TimelineEvent({ dreamersById, event }: TimelineEventProps) {
  const presentation = EVENT_PRESENTATION[event.kind];
  const Icon = presentation.icon;
  const actor = event.actorDreamerId
    ? dreamersById.get(event.actorDreamerId)
    : undefined;
  const target = event.targetDreamerId
    ? dreamersById.get(event.targetDreamerId)
    : undefined;
  const actorName = actor?.name ?? (event.actorDreamerId ? 'Unknown' : 'Terrarium');

  return (
    <li
      className={`timeline-event timeline-event--${presentation.privacy}`}
      style={actor ? { '--event-color': actor.color } as CSSProperties : undefined}
    >
      <div className="timeline-event__rail">
        <span><Icon size={15} /></span>
      </div>
      <article>
        <header>
          <div className="event-provenance">
            <span className="event-sequence">#{event.sequence}</span>
            <span>tick {event.tick}</span>
            <span>{presentation.label}</span>
            {event.parentSequence ? (
              <span>from #{event.parentSequence}</span>
            ) : null}
          </div>
          <time dateTime={event.createdAt}>
            {dayjs(event.createdAt).format('HH:mm:ss')}
          </time>
        </header>
        <h3>{event.title}</h3>
        <p>{event.content}</p>
        <footer>
          <span className="event-actor">
            {actor ? <i style={{ backgroundColor: actor.color }} /> : null}
            {actorName}
          </span>
          {target ? (
            <span className="event-target">
              <span aria-hidden="true">→</span>
              {target.name}
            </span>
          ) : null}
          <span className={`privacy-chip privacy-chip--${presentation.privacy}`}>
            {privacyLabel(presentation.privacy)}
          </span>
        </footer>
      </article>
    </li>
  );
}

function privacyLabel(privacy: EventPresentation['privacy']): string {
  return {
    world: 'shared',
    whisper: 'private',
    operator: 'internal',
  }[privacy];
}
