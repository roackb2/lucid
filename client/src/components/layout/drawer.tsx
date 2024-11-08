import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/general/app-sidebar"
import DashboardBreadcrumb from "@/components/general/dashboard-breadcumb"

export default function Drawer({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main>
        <div className="flex p-4 items-center justify-start gap-4">
          <SidebarTrigger />
          <DashboardBreadcrumb />
        </div>
        {children}
      </main>
    </SidebarProvider>
  )
}
