import dayjs from 'dayjs';
import {
  CheckCircle2,
  CircleAlert,
  CircleSlash2,
  FolderPlus,
  Lightbulb,
  LockKeyhole,
  MessageSquareReply,
  MessagesSquare,
  PlayCircle,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { AgentView, DiscoveryEvent } from '@/lib/trpc';

type ActivityLogProps = {
  agents: AgentView[];
  events: DiscoveryEvent[];
};

type EventPresentation = {
  icon: LucideIcon;
  label: string;
  visibility: 'shared' | 'private' | 'user' | 'internal';
};

const EVENT_PRESENTATION: Record<
  DiscoveryEvent['kind'],
  EventPresentation
> = {
  workspace_created: {
    icon: FolderPlus,
    label: 'Workspace',
    visibility: 'shared',
  },
  interest_saved: {
    icon: Search,
    label: 'Interest',
    visibility: 'user',
  },
  check_requested: {
    icon: Search,
    label: 'Check request',
    visibility: 'user',
  },
  agent_wake_started: {
    icon: PlayCircle,
    label: 'Agent wake',
    visibility: 'internal',
  },
  shared_message: {
    icon: MessagesSquare,
    label: 'Shared message',
    visibility: 'shared',
  },
  direct_message: {
    icon: LockKeyhole,
    label: 'Direct message',
    visibility: 'private',
  },
  finding_reported: {
    icon: Lightbulb,
    label: 'Finding',
    visibility: 'user',
  },
  feedback_saved: {
    icon: MessageSquareReply,
    label: 'Feedback',
    visibility: 'user',
  },
  participant_added: {
    icon: Users,
    label: 'Participant added',
    visibility: 'internal',
  },
  participant_disabled: {
    icon: Users,
    label: 'Participant paused',
    visibility: 'internal',
  },
  participant_enabled: {
    icon: Users,
    label: 'Participant enabled',
    visibility: 'internal',
  },
  participant_retired: {
    icon: Users,
    label: 'Participant retired',
    visibility: 'internal',
  },
  agent_wake_no_action: {
    icon: CircleSlash2,
    label: 'No action',
    visibility: 'internal',
  },
  agent_wake_completed: {
    icon: CheckCircle2,
    label: 'Wake result',
    visibility: 'internal',
  },
  error: {
    icon: CircleAlert,
    label: 'System',
    visibility: 'internal',
  },
};

export function ActivityLog({ agents, events }: ActivityLogProps) {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <section className="activity-log" aria-labelledby="activity-log-title">
      <header className="activity-section-heading">
        <div>
          <p className="section-label">Append-only event history</p>
          <h3 id="activity-log-title">Event log</h3>
        </div>
        <span>{events.length} recent events</span>
      </header>

      <div className="visibility-key" aria-label="Event visibility">
        <span><i className="visibility-shared" /> all agents</span>
        <span><i className="visibility-private" /> target agent</span>
        <span><i className="visibility-user" /> you + Lucid</span>
        <span><i className="visibility-internal" /> operator only</span>
      </div>

      <ol>
        {events.toReversed().map((event) => {
          const presentation = EVENT_PRESENTATION[event.kind];
          const Icon = presentation.icon;
          const actor = event.actorAgentId
            ? agentById.get(event.actorAgentId)
            : undefined;
          const target = event.targetAgentId
            ? agentById.get(event.targetAgentId)
            : undefined;
          const userAuthored = [
            'interest_saved',
            'check_requested',
            'feedback_saved',
          ].includes(event.kind);

          return (
            <li
              className={`activity-event activity-event--${presentation.visibility}`}
              key={event.id}
            >
              <span className="activity-event__icon" aria-hidden="true">
                <Icon size={14} />
              </span>
              <article>
                <header>
                  <div>
                    <span>#{event.sequence}</span>
                    <span>wake {event.wakeNumber}</span>
                    <span>{presentation.label}</span>
                    {event.parentSequence
                      ? <span>from #{event.parentSequence}</span>
                      : null}
                  </div>
                  <time dateTime={event.createdAt}>
                    {dayjs(event.createdAt).format('HH:mm:ss')}
                  </time>
                </header>
                <h4>{event.title}</h4>
                <p>{event.content}</p>
                <footer>
                  <span>{actor?.name ?? (userAuthored ? 'You' : 'System')}</span>
                  {target ? <span>→ {target.name}</span> : null}
                  <span className={`visibility-chip visibility-chip--${presentation.visibility}`}>
                    {visibilityLabel(presentation.visibility)}
                  </span>
                </footer>
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function visibilityLabel(
  visibility: EventPresentation['visibility'],
): string {
  return {
    shared: 'shared',
    private: 'agent private',
    user: 'user private',
    internal: 'internal',
  }[visibility];
}
