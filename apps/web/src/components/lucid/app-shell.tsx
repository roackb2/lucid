import {
  Bot,
  Globe2,
  Lightbulb,
  LogOut,
  MessageCircle,
  Search,
  Settings,
} from 'lucide-react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import type { ComponentType, SVGProps } from 'react';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ChatDrawer } from '@/components/lucid/chat-drawer';
import {
  AgentFoundationPage,
  FindingsFoundationPage,
  InterestFoundationPage,
  SettingsFoundationPage,
} from '@/components/lucid/workspace-foundation-pages';
import {
  InformationNetworkPage,
  InformationNetworkPostPage,
  InformationNetworkProfilePage,
} from '@/components/lucid/information-network-pages';

type LucidAppShellProps = {
  snapshot: DiscoverySnapshot;
  isRetryingCurrentWake: boolean;
  isRunningNow: boolean;
  isSavingInterest: boolean;
  isUpdatingBackground: boolean;
  onRetryCurrentWake(): Promise<unknown>;
  onRunNow(): Promise<unknown>;
  onSaveInterest(content: string): Promise<unknown>;
  onSetBackgroundChecksEnabled(enabled: boolean): Promise<unknown>;
  onSignOut?: () => Promise<void>;
};

type NavigationItem = {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export const WORKSPACE_HOME_PATH = '/network';

export const workspaceNavigationItems: NavigationItem[] = [
  { label: 'Network', path: '/network', icon: Globe2 },
  { label: 'Findings', path: '/findings', icon: Search },
  { label: 'Interest', path: '/interests', icon: Lightbulb },
  { label: 'Agent', path: '/agent', icon: Bot },
];

const workspacePageLabelResolvers = [
  { label: 'Network', matches: (path: string) => path === '/network' },
  { label: 'Post', matches: (path: string) => path.startsWith('/network/posts/') },
  { label: 'Profile', matches: (path: string) => path.startsWith('/profiles/') },
  { label: 'Findings', matches: (path: string) => path === '/findings' },
  { label: 'Interest', matches: (path: string) => path === '/interests' },
  { label: 'Agent', matches: (path: string) => path === '/agent' },
  { label: 'Settings', matches: (path: string) => path === '/settings' },
];

export const resolveWorkspacePageLabel = (path: string): string => (
  workspacePageLabelResolvers.find(({ matches }) => matches(path))?.label
    ?? 'Network'
);

export function LucidAppShell({
  isRetryingCurrentWake,
  isRunningNow,
  isSavingInterest,
  isUpdatingBackground,
  onRetryCurrentWake,
  onRunNow,
  onSaveInterest,
  onSetBackgroundChecksEnabled,
  onSignOut,
  snapshot,
}: LucidAppShellProps) {
  const location = useLocation();
  const pageLabel = resolveWorkspacePageLabel(location.pathname);
  const agentState = resolveAgentState(snapshot);

  return (
    <div className="lucid-shell">
      <a className="lucid-shell__skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="lucid-shell__rail">
        <div className="lucid-shell__brand">
          <span className="lucid-shell__brand-mark" aria-hidden="true">L</span>
          <span>
            <strong>Lucid</strong>
            <small>Discovery workspace</small>
          </span>
        </div>

        <nav className="lucid-shell__nav" aria-label="Lucid workspace">
          <p className="lucid-shell__nav-label">Workspace</p>
          {workspaceNavigationItems.map(({ icon: Icon, label, path }) => (
            <NavLink
              aria-label={label}
              className={({ isActive }) => cn(
                'lucid-shell__nav-item',
                isActive && 'lucid-shell__nav-item--active',
              )}
              key={path}
              to={path}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
          <NavLink
            aria-label="Settings"
            className={({ isActive }) => cn(
              'lucid-shell__nav-item lucid-shell__mobile-settings',
              isActive && 'lucid-shell__nav-item--active',
            )}
            to="/settings"
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
          {onSignOut ? (
            <button
              aria-label="Sign out"
              className="lucid-shell__nav-item lucid-shell__mobile-sign-out"
              onClick={() => void onSignOut()}
              type="button"
            >
              <LogOut aria-hidden="true" />
              <span>Sign out</span>
            </button>
          ) : null}
        </nav>

        <section className="lucid-shell__focus" aria-labelledby="current-focus">
          <p className="lucid-shell__nav-label" id="current-focus">
            Current interest
          </p>
          <NavLink to="/interests" className="lucid-shell__focus-card">
            <span className="lucid-shell__focus-icon" aria-hidden="true">
              <Lightbulb />
            </span>
            <span>
              <strong>{snapshot.interest?.title ?? 'No interest saved'}</strong>
              <small>
                {snapshot.interest
                  ? 'Used for background discovery'
                  : 'Set the first current interest'}
              </small>
            </span>
          </NavLink>
        </section>

        <div className="lucid-shell__rail-footer">
          <div className="lucid-shell__agent-state">
            <span
              className={cn(
                'lucid-shell__status-dot',
                `lucid-shell__status-dot--${agentState.tone}`,
              )}
              aria-hidden="true"
            />
            <span>
              <strong>{snapshot.agent.name}</strong>
              <small>{agentState.label}</small>
            </span>
          </div>
          <NavLink
            aria-label="Settings"
            className={({ isActive }) => cn(
              'lucid-shell__nav-item',
              isActive && 'lucid-shell__nav-item--active',
            )}
            to="/settings"
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </NavLink>
          {onSignOut ? (
            <button
              aria-label="Sign out"
              className="lucid-shell__nav-item lucid-shell__sign-out"
              onClick={() => void onSignOut()}
              type="button"
            >
              <LogOut aria-hidden="true" />
              <span>Sign out</span>
            </button>
          ) : null}
        </div>
      </aside>

      <div className="lucid-shell__workspace">
        <header className="lucid-shell__topbar">
          <div>
            <span className="lucid-shell__eyebrow">Lucid workspace</span>
            <strong>{pageLabel}</strong>
          </div>
          <ChatDrawer
            trigger={(
              <Button variant="secondary">
                <MessageCircle aria-hidden="true" />
                Chat
              </Button>
            )}
          />
        </header>

        <main className="lucid-shell__content" id="main-content">
          <Routes>
            <Route path="/network" element={<InformationNetworkPage />} />
            <Route
              path="/network/posts/:postId"
              element={<InformationNetworkPostPage />}
            />
            <Route
              path="/profiles/:profileId"
              element={<InformationNetworkProfilePage />}
            />
            <Route
              path="/findings"
              element={<FindingsFoundationPage snapshot={snapshot} />}
            />
            <Route
              path="/interests"
              element={(
                <InterestFoundationPage
                  isSaving={isSavingInterest}
                  onSaveInterest={onSaveInterest}
                  snapshot={snapshot}
                />
              )}
            />
            <Route
              path="/agent"
              element={(
                <AgentFoundationPage
                  isRetrying={isRetryingCurrentWake}
                  isRunningNow={isRunningNow}
                  isUpdatingBackground={isUpdatingBackground}
                  onRetry={onRetryCurrentWake}
                  onRunNow={onRunNow}
                  onSetBackgroundChecksEnabled={
                    onSetBackgroundChecksEnabled
                  }
                  snapshot={snapshot}
                />
              )}
            />
            <Route
              path="/settings"
              element={<SettingsFoundationPage snapshot={snapshot} />}
            />
            <Route
              path="/"
              element={<Navigate replace to={WORKSPACE_HOME_PATH} />}
            />
            <Route
              path="*"
              element={<Navigate replace to={WORKSPACE_HOME_PATH} />}
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function resolveAgentState(snapshot: DiscoverySnapshot): {
  label: string;
  tone: 'ready' | 'working' | 'attention' | 'paused';
} {
  const hasFailedTask = snapshot.backgroundChecks.tasks.some(
    ({ agentId, status }) => (
      agentId === snapshot.agent.id && status === 'failed'
    ),
  );

  if (snapshot.agent.status === 'error' || hasFailedTask) {
    return { label: 'Needs attention', tone: 'attention' };
  }
  if (snapshot.agent.status === 'running' || snapshot.backgroundChecks.running) {
    return { label: 'Working now', tone: 'working' };
  }
  if (
    !snapshot.backgroundChecks.dispatchEnabled
    || !snapshot.backgroundChecks.enabled
  ) {
    return { label: 'Background work paused', tone: 'paused' };
  }
  return { label: 'Ready in the background', tone: 'ready' };
}
