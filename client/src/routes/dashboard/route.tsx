import Drawer from '@/components/layout/drawer'
import useGlobalWebSocket from '@/hooks/ws/useGlobalWebSocket'
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
})

export function DashboardLayout() {

  useGlobalWebSocket()

  return (
    <Drawer>
      <Outlet />
    </Drawer>
  )
}
