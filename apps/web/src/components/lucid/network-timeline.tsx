import dayjs from 'dayjs';
import {
  Archive,
  CircleAlert,
  Feather,
  Home,
  LockKeyhole,
  MessageCircle,
  MessageSquareReply,
  Moon,
  Radio,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AgentView, NetworkEvent } from '@/lib/trpc';

type NetworkTimelineProps = {
  agents: AgentView[];
  events: NetworkEvent[];
};

type EventPresentation = {
  icon: LucideIcon;
  label: string;
  privacy: 'shared' | 'private' | 'principal' | 'internal';
};

const EVENT_PRESENTATION: Record<NetworkEvent['kind'], EventPresentation> = {
  origin: { icon: Sparkles, label: 'Origin', privacy: 'shared' },
  intent: { icon: Feather, label: 'Intent', privacy: 'principal' },
  wake: { icon: Radio, label: 'Wake', privacy: 'internal' },
  shared_post: { icon: MessageCircle, label: 'Commons', privacy: 'shared' },
  direct_message: { icon: LockKeyhole, label: 'Direct', privacy: 'private' },
  return: { icon: Home, label: 'Return', privacy: 'principal' },
  feedback: { icon: MessageSquareReply, label: 'Feedback', privacy: 'principal' },
  rest: { icon: Moon, label: 'Rest', privacy: 'internal' },
  reflection: { icon: Archive, label: 'Reflection', privacy: 'internal' },
  error: { icon: CircleAlert, label: 'System', privacy: 'internal' },
};

export function NetworkTimeline({
  agents,
  events,
}: NetworkTimelineProps) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const visibleEvents = events.toReversed();

  return (
    <section className="network-ledger" aria-labelledby="network-ledger-title">
      <div className="section-heading ledger-heading">
        <div>
          <p className="eyebrow">Causal, inspectable, append-only</p>
          <h3 id="network-ledger-title">Network ledger</h3>
        </div>
        <p>{events.length} recent events</p>
      </div>

      <div className="privacy-key" aria-label="Event visibility legend">
        <span><i className="privacy-shared" /> every agent</span>
        <span><i className="privacy-private" /> target agent</span>
        <span><i className="privacy-principal" /> you + Aster</span>
        <span><i className="privacy-internal" /> lab operator</span>
      </div>

      <ol className="timeline">
        {visibleEvents.map((event) => (
          <TimelineEvent
            agentsById={agentsById}
            event={event}
            key={event.id}
          />
        ))}
      </ol>
    </section>
  );
}

type TimelineEventProps = {
  agentsById: Map<string, AgentView>;
  event: NetworkEvent;
};

function TimelineEvent({ agentsById, event }: TimelineEventProps) {
  const presentation = EVENT_PRESENTATION[event.kind];
  const Icon = presentation.icon;
  const actor = event.actorAgentId
    ? agentsById.get(event.actorAgentId)
    : undefined;
  const target = event.targetAgentId
    ? agentsById.get(event.targetAgentId)
    : undefined;

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
        <h4>{event.title}</h4>
        <p>{event.content}</p>
        <footer>
          <span className="event-actor">
            {actor ? <i style={{ backgroundColor: actor.color }} /> : null}
            {actor?.name ?? (event.kind === 'intent' || event.kind === 'feedback'
              ? 'You'
              : 'Lucid')}
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
    shared: 'shared',
    private: 'agent private',
    principal: 'principal private',
    internal: 'internal',
  }[privacy];
}
