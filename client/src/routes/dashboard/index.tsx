import CreateAgentForm from '@/components/features/create-agent-form'
import Drawer from '@/components/layout/drawer'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCreateAgent } from '@/hooks/api/useAgents'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/')({
  component: Dashboard,
})

function Dashboard() {

  return (
    <Drawer>
      <div className="p-4">
        <CreateAgentForm />
      </div>
    </Drawer>
  )
}
