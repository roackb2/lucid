
import { definitions } from '@/types/apiTypes'
import { useEffect, useState } from 'react'

interface AgentStatusCardProps {
  notification: definitions['ws.WsMessage']
}


export default function AgentStatusCard({ notification }: AgentStatusCardProps) {
  const [agentId, setAgentId] = useState<string | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)

  useEffect(() => {
    console.log(notification)
    switch (notification.event) {
      case 'agent_progress':
        setAgentId(notification.data?.progress?.agent_id)
        setMessage(notification.data?.progress?.progress)
        break
      case 'agent_response':
        setAgentId(notification.data?.response?.agent_id)
        setMessage(notification.data?.response?.response)
        break
    }
  }, [notification])

  return (
    <div className="flex flex-col gap-2 rounded-md border p-2 max-w-[500px]">
      <p className="text-sm font-medium text-gray-500">{agentId}</p>
      {message && <p className="text-sm">{message}</p>}
    </div>
  )
}
