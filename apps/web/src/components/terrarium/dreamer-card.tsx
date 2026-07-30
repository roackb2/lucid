import { Eye, Moon, Radio, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { DreamerView } from '@/lib/trpc';

type DreamerCardProps = {
  dreamer: DreamerView;
  isActive: boolean;
  isSelected: boolean;
  onSelect(): void;
};

const STATUS_ICON = {
  resting: Moon,
  waking: Radio,
  error: TriangleAlert,
};

export function DreamerCard({
  dreamer,
  isActive,
  isSelected,
  onSelect,
}: DreamerCardProps) {
  const StatusIcon = STATUS_ICON[dreamer.status];
  const style = {
    '--dreamer-color': dreamer.color,
  } as CSSProperties;

  return (
    <button
      className={cn(
        'dreamer-card',
        isSelected && 'dreamer-card--selected',
        isActive && 'dreamer-card--active',
      )}
      onClick={onSelect}
      style={style}
      type="button"
      aria-pressed={isSelected}
    >
      <span className="dreamer-card__glow" aria-hidden="true" />
      <span className="dreamer-card__topline">
        <span className="dreamer-sigil" aria-hidden="true">{dreamer.sigil}</span>
        <span className={`dreamer-state dreamer-state--${dreamer.status}`}>
          <StatusIcon size={13} />
          {dreamer.status}
        </span>
      </span>
      <span className="dreamer-card__identity">
        <strong>{dreamer.name}</strong>
        <em>{dreamer.archetype}</em>
      </span>
      <span className="dreamer-card__purpose">{dreamer.purpose}</span>
      <span className="dreamer-card__metrics">
        <span>
          <Eye size={14} />
          {dreamer.unreadCount} unread
        </span>
        <span>{dreamer.wakeCount} wakes</span>
      </span>
    </button>
  );
}
