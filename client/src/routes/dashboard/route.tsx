import Drawer from '@/components/layout/drawer'
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
})

export function DashboardLayout() {
  return (
    <Drawer>
      <Outlet />
    </Drawer>
  )
}
