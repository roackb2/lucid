import { agentMessagesByAgentIdAtom, readyStateAtom, readyStateTextAtom } from '@/atoms/websocketAtoms'
import AgentStatusCard from '@/components/features/agent-status-card'
import CreateAgentForm from '@/components/features/create-agent-form'
import StatusIndicator from '@/components/features/status-indicator'
import { createFileRoute } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'

export const Route = createFileRoute('/dashboard/experiments/single-agent/')({
  component: SingleAgent,
})


function SingleAgent() {
  const readyState = useAtomValue(readyStateAtom)
  const readyStateText = useAtomValue(readyStateTextAtom)
  const agentMessagesByAgentId = useAtomValue(agentMessagesByAgentIdAtom)

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-row items-center gap-2 bg-gray-100 p-2 rounded-md">
        <span className="text-sm text-gray-500">
          WebSocket: {readyStateText}
        </span>
        <StatusIndicator status={readyState} />
      </div>
      <CreateAgentForm />
      <div className="flex flex-row flex-wrap gap-4">
        {Object.entries(agentMessagesByAgentId).map(
          ([agentId, messages], index) => (
            <AgentStatusCard
              key={index}
              agentId={agentId}
              messages={messages}
            />
          ),
        )}
      </div>
    </div>
  )
}
