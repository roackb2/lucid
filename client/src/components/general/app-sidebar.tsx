import {
  Calendar, Home, Inbox, Search, Settings, FlaskConical, ChevronRight,
  ChevronDown,
  Bot
} from "lucide-react"
import { Link } from "@tanstack/react-router"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubItem,
  SidebarMenuSub,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible"
import { useCallback, useState } from "react"
import { cn } from "@/lib/utils"
import { AnimatePresence, motion } from "framer-motion"
const baseUrl = '/dashboard'
import Logo from '@/assets/logo.jpg'

// Menu items.
const items = [
  {
    title: 'Home',
    url: '/home',
    icon: Home,

  },
  {
    title: 'Experiments',
    url: '/experiments',
    icon: FlaskConical,
    subItems: [
      {
        title: 'Single Agent',
        url: '/single-agent',
        icon: Bot,
      },
      {
        title: 'All Agents',
        url: '/all-agents',
        icon: Bot,
      }
    ],
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
]

export function AppSidebar() {
  const [openItems, setOpenItems] = useState<string[]>(items.filter(item => item.subItems).map(item => item.title))

  const handleOpenChange = useCallback((itemTitle: string, open: boolean) => {
    setOpenItems(prev => open ? [...prev, itemTitle] : prev.filter(title => title !== itemTitle))
  }, [])

  const isItemOpen = useCallback((itemTitle: string) => {
    return openItems.includes(itemTitle)
  }, [openItems])

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex flex-row items-center gap-2 hover:bg-gray-100 p-2 rounded-md">
          <img src={Logo} alt="Logo" className="w-10 h-10 rounded-md" />
          <div className="flex flex-col">
            <span className="text-lg font-semibold">Lucid</span>
            <span className="text-sm text-gray-500">Agent collaboration</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                if (item.subItems) {
                  return (
                    <Collapsible
                      key={item.title}
                      defaultOpen={isItemOpen(item.title)}
                      className="group/collapsible"
                      onOpenChange={open => handleOpenChange(item.title, open)}
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton className="flex flex-row items-center justify-between hover:bg-gray-100">
                            <div className="flex flex-row items-center gap-2">
                              <item.icon width={16} height={16} />
                              <span>{item.title}</span>
                            </div>
                            <motion.div
                              animate={{ rotate: isItemOpen(item.title) ? 0 : -90 }}
                              transition={{ duration: 0.1, bounce: 0 }}
                            >
                              <ChevronDown width={16} height={16} />
                            </motion.div>
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <AnimatePresence data-testid="animate-presence">
                          <motion.div
                            key={item.title}
                            initial={{ height: isItemOpen(item.title) ? 'auto' : 0 }}
                            animate={{ height: isItemOpen(item.title) ? 'auto' : 0 }}
                            exit={{ height: isItemOpen(item.title) ? 0 : 'auto' }}
                            style={{ overflow: 'hidden' }}
                            transition={{ duration: 0.1, bounce: 0 }}
                            data-testid="motion-div"
                          >
                            <SidebarMenuSub>
                              {item.subItems.map((subItem) => (
                                <SidebarMenuSubItem key={subItem.title}>
                                  <SidebarMenuButton asChild className="hover:bg-gray-100">
                                    <Link to={`${baseUrl}${item.url}${subItem.url}`}>
                                      <subItem.icon />
                                      <span>{subItem.title}</span>
                                    </Link>
                                  </SidebarMenuButton>
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </motion.div>
                        </AnimatePresence>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                } else {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild className="hover:bg-gray-100">
                        <Link to={`${baseUrl}${item.url}`}>
                          <item.icon width={16} height={16} />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                }
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar >
  )
}
