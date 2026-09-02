import { CircleCheck, Construction, FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';

export type FoundationPageReadiness =
  | 'working'
  | 'planned'
  | 'preview'
  | 'fixture';

const readinessPresentation: Record<
  FoundationPageReadiness,
  { icon: ReactNode; label: string }
> = {
  fixture: {
    icon: <FlaskConical aria-hidden="true" />,
    label: 'Server-backed fixtures',
  },
  planned: {
    icon: <Construction aria-hidden="true" />,
    label: 'Not yet built',
  },
  preview: {
    icon: <FlaskConical aria-hidden="true" />,
    label: 'Prototype data',
  },
  working: {
    icon: <CircleCheck aria-hidden="true" />,
    label: 'Working · live data',
  },
};

/**
 * Shared page heading for Lucid product surfaces.
 *
 * Readiness is explicit so previews and fixtures cannot be mistaken for live
 * agent-authored product data.
 */
export function FoundationPage({
  children,
  description,
  eyebrow,
  readiness,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  readiness: FoundationPageReadiness;
  title: string;
}) {
  const presentation = readinessPresentation[readiness];

  return (
    <div className="foundation-page">
      <header className="foundation-page__heading">
        <div>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <span className="foundation-badge" data-state={readiness}>
          {presentation.icon}
          {presentation.label}
        </span>
        <p>{description}</p>
      </header>
      {children}
    </div>
  );
}
