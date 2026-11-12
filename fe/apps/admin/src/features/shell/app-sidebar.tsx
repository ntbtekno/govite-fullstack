import { Link } from "@tanstack/react-router"
import {
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  MegaphoneIcon,
  ActivityIcon,
  BuildingIcon,
  ReceiptIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldIcon,
  UsersIcon,
  WebhookIcon,
} from "lucide-react"
import type { Resource, Action } from "@app/contracts"
import { NavMain, type NavItem } from "@/features/shell/nav-main"
import { NavUser } from "@/features/shell/nav-user"
import { useAuth } from "@/lib/auth-context"
import { usePublicSettings } from "@/lib/public-settings"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@app/ui/components/sidebar"

type Guarded = NavItem & { permission?: [Resource, Action] }

const overview: Guarded[] = [
  {
    title: "Dashboard",
    url: "/admin/dashboard",
    icon: <LayoutDashboardIcon />,
  },
]

const administration: Guarded[] = [
  {
    title: "Users",
    url: "/admin/administration/users",
    icon: <UsersIcon />,
    permission: ["users", "view"],
  },
  {
    title: "Mitra",
    url: "/admin/administration/mitra",
    icon: <BuildingIcon />,
    permission: ["mitra", "view"],
  },
  {
    title: "Announcements",
    url: "/admin/administration/announcements",
    icon: <MegaphoneIcon />,
    permission: ["announcements", "manage"],
  },
  {
    title: "Roles",
    url: "/admin/administration/roles",
    icon: <ShieldIcon />,
    permission: ["roles", "manage"],
  },
  {
    title: "Permissions",
    url: "/admin/administration/permissions",
    icon: <KeyRoundIcon />,
    permission: ["permissions", "view"],
  },
  {
    title: "Audit log",
    url: "/admin/administration/audit",
    icon: <ScrollTextIcon />,
    permission: ["audit", "view"],
  },
  {
    title: "Webhooks",
    url: "/admin/administration/webhooks",
    icon: <WebhookIcon />,
    permission: ["webhooks", "manage"],
  },
  {
    title: "API keys",
    url: "/admin/administration/api-keys",
    icon: <KeyRoundIcon />,
    permission: ["apiKeys", "manage"],
  },
  {
    title: "Settings",
    url: "/admin/administration/settings",
    icon: <SettingsIcon />,
    permission: ["settings", "manage"],
  },
  {
    title: "System status",
    url: "/admin/administration/system",
    icon: <ActivityIcon />,
    permission: ["settings", "manage"],
  },
]

// Mitra-only reporting menus. The group is rendered only for a mitra session,
// so a Superadmin never sees it even if it holds the permission.
const reports: Guarded[] = [
  {
    title: "Billing Tagihan",
    url: "/admin/billing",
    icon: <ReceiptIcon />,
    permission: ["billing", "view"],
  },
  {
    title: "History Payment",
    url: "/admin/payment-history",
    icon: <HistoryIcon />,
    permission: ["payments", "view"],
  },
]

// Mitra-only Tools menus. The group is rendered only for a mitra session.
const tools: Guarded[] = [
  {
    title: "Create VA",
    url: "/admin/tools/create-va",
    icon: <ActivityIcon />,
    permission: ["va", "view"],
  },
]

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { can, user } = useAuth()
  const settings = usePublicSettings()
  const appName = settings.data?.appName ?? "Rekan NTB"
  const appTagline = settings.data?.tagline ?? "Bank NTB Syariah"
  const logoUrl = settings.data?.logoUrl ?? "/images/logo-bank-ntb-syariah.webp"
  const visible = (items: Guarded[]) =>
    items.filter((i) => !i.permission || can(...i.permission))
  // A mitra session must not reach the user detail page at all: its own data
  // lives on the Account page, so the Users item is hidden entirely. A
  // non-mitra session keeps the item pointing at the user list.
  const adminItems = visible(administration).filter(
    (i) => !(i.title === "Users" && user?.mitraId)
  )
  // The reporting group exists only for a mitra session.
  const reportItems = user?.mitraId ? visible(reports) : []
  // The tools group exists only for a mitra session.
  const toolItems = user?.mitraId ? visible(tools) : []

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/admin/dashboard">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 dark:bg-slate-800/80 ring-1 ring-slate-200 dark:ring-slate-700">
                  <img
                    src={logoUrl}
                    alt="Bank NTB Syariah"
                    className="h-[36px] w-auto object-contain"
                  />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{appName}</span>
                  <span className="truncate text-xs">{appTagline}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain label="Overview" items={visible(overview)} />
        {reportItems.length > 0 && (
          <NavMain label="Laporan" items={reportItems} />
        )}
        {toolItems.length > 0 && (
          <NavMain label="Tools" items={toolItems} />
        )}
        {adminItems.length > 0 && (
          <NavMain label="Administration" items={adminItems} />
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  )
}
