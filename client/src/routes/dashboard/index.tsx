import AgentStatusCard from '@/components/features/aget-status-card'
import CreateAgentForm from '@/components/features/create-agent-form'
import StatusIndicator from '@/components/features/status-indicator'
import Drawer from '@/components/layout/drawer'
import useWebsocket from '@/hooks/ws/useWebsocket'
import { definitions } from '@/types/apiTypes'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/')({
  component: Dashboard,
})

function Dashboard() {
  const { readyState, messageHistory } = useWebsocket()

  return (
    <Drawer>
      <div className="p-4">
        <CreateAgentForm />
        <div className="flex flex-row items-center gap-2">Connection status: <StatusIndicator status={readyState} /></div>
        <div className="flex flex-col gap-2">
          <span>Message history</span>
          {messageHistory.map((message, index) => (
            <AgentStatusCard key={index} notification={message} />
          ))}
        </div>
      </div>
    </Drawer>
  )
}
