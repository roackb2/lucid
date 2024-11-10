import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/general/app-sidebar"
import AppBreadcrumb from "@/components/general/app-breadcrumb"

export default function Drawer({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex flex-col flex-1 h-full w-full" >
        <div className="flex p-4 items-center justify-start gap-4">
          <SidebarTrigger />
          <AppBreadcrumb />
        </div>
        {children}
      </main>
    </SidebarProvider>
  )
}
