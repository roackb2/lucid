import Drawer from '@/components/layout/drawer'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard/')({
  component: Dashboard,
})

function Dashboard() {
  return (
    <Drawer>
      <div className="p-2"> Dashboard </div>
    </Drawer>
  )
}
