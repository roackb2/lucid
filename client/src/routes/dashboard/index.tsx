import CreateAgentForm from '@/components/features/create-agent-form'
import Drawer from '@/components/layout/drawer'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateAgent } from '@/hooks/api/useAgents'
import useWebsocket from '@/hooks/ws/useWebsocket'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/')({
  component: Dashboard,
})

function Dashboard() {
  const { connectionStatus, messageHistory } = useWebsocket()
  return (
    <Drawer>
      <div className="p-4">
        <CreateAgentForm />
        <div>Connection status: {connectionStatus}</div>
        <div className="flex flex-col gap-2">
          <span>Message history</span>
          {messageHistory.map((message, index) => (
            <div key={index} className="flex flex-col border border-gray-200 p-2 rounded-md">
              <div>Event: {message.event}</div>
              <div>Data: {JSON.stringify(message.data)}</div>
            </div>
          ))}
        </div>
      </div>
    </Drawer>
  )
}
