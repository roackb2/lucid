import AgentStatusCard from '@/components/features/aget-status-card'
import CreateAgentForm from '@/components/features/create-agent-form'
import StatusIndicator from '@/components/features/status-indicator'
import Drawer from '@/components/layout/drawer'
import useWebsocket from '@/hooks/ws/useWebsocket'
import { AgentNotificationTypes } from '@/types/layout'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

export const Route = createFileRoute('/dashboard/experiments/single-agent/')({
  component: SingleAgent,
})

const agentEvents = ['agent_progress', 'agent_response']

function SingleAgent() {
  const { readyState, readyStateText, messageHistory } = useWebsocket()
  const [agentIds, setAgentIds] = useState<string[]>([])

  const onAgentCreated = (agentId: string) => {
    if (!agentIds.includes(agentId)) {
      setAgentIds([...agentIds, agentId])
    }
  }

  const agentMessageData = useMemo(() => {
    return messageHistory
      .filter((message) => agentEvents.includes(message.event ?? ''))
      .map((message) => {
        switch (message.event) {
          case 'agent_progress':
            return message.data?.progress
          case 'agent_response':
            return message.data?.response
        }
      }) as AgentNotificationTypes[]
  }, [messageHistory])

  const agentMessagesByAgentId = useMemo(() => {
    return agentMessageData.reduce(
      (acc, message) => {
        acc[message.agent_id ?? ''] = [
          ...(acc[message.agent_id ?? ''] ?? []),
          message,
        ]
        return acc
      },
      {} as Record<string, AgentNotificationTypes[]>,
    )
  }, [agentMessageData])

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-row items-center gap-2 bg-gray-100 p-2 rounded-md">
        <span className="text-sm text-gray-500">
          WebSocket: {readyStateText}
        </span>
        <StatusIndicator status={readyState} />
      </div>
      <CreateAgentForm onSuccess={onAgentCreated} />
      <div className="flex flex-col gap-4">
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
