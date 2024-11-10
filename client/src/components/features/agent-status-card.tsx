
import { definitions } from '@/types/apiTypes'
import { AgentNotificationTypes } from '@/types/layout'
import { useEffect, useState } from 'react'

interface AgentStatusCardProps {
  agentId: string
  messages: AgentNotificationTypes[]
}


export default function AgentStatusCard({ agentId, messages }: AgentStatusCardProps) {
  const lastMessage = messages[messages.length - 1]
  const lastStatusMessage: definitions['worker.WorkerStatusNotification'] | undefined = messages.find(
    (message) => 'status' in message,
  )
  const lastProgressMessage: definitions['worker.WorkerProgressNotification'] | undefined = messages.find(
    (message) => 'progress' in message,
  )
  const lastResponseMessage: definitions['worker.WorkerResponseNotification'] | undefined = messages.find(
    (message) => 'response' in message,
  )

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 max-w-[500px]">
      <p className="text-sm font-medium text-gray-500">
        {agentId} ({lastStatusMessage?.status})
      </p>
      {lastProgressMessage?.progress && (
        <p className="text-sm">{lastProgressMessage.progress}</p>
      )}
      {lastResponseMessage?.response && (
        <p className="text-sm">{lastResponseMessage.response}</p>
      )}
    </div>
  )
}
