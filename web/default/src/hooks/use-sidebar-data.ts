import {
  LayoutDashboard,
  Key,
  FileText,
  Wallet,
  Box,
  Users,
  Ticket,
  User,
  Command,
  Radio,
  FlaskConical,
  ImagePlus,
  CreditCard,
  ChartColumnIncreasing,
  Settings,
  Bot,
  ShoppingBag,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WORKSPACE_IDS } from '@/components/layout/lib/workspace-registry'
import { type SidebarData } from '@/components/layout/types'

export function useSidebarData(): SidebarData {
  const { t } = useTranslation()

  return {
    workspaces: [
      {
        id: WORKSPACE_IDS.DEFAULT,
        name: '', // Dynamically fetches system name
        logo: Command,
        plan: '', // Dynamically fetches system version
      },
    ],
    navGroups: [
      {
        id: 'usage',
        title: t('Usage'),
        items: [
          {
            title: t('Online Model Testing'),
            url: '/playground',
            icon: FlaskConical,
          },
          {
            title: t('Image Generation'),
            url: '/playground/images',
            icon: ImagePlus,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Codex 账号托管'),
            url: '/codex-accounts',
            icon: Bot,
          },
          {
            title: t('Codex 跳蚤市场'),
            url: '/codex-marketplace',
            icon: ShoppingBag,
          },
        ],
      },
      {
        id: 'data',
        title: t('Data'),
        items: [
          {
            title: t('Board'),
            url: '/dashboard/models',
            activeUrls: ['/dashboard/models', '/dashboard/users'],
            icon: LayoutDashboard,
          },
          {
            title: t('Usage Logs'),
            url: '/usage-logs/common',
            icon: FileText,
          },
        ],
      },
      {
        id: 'personal',
        title: t('Personal'),
        items: [
          {
            title: t('Preferences'),
            url: '/profile',
            icon: User,
          },
          {
            title: t('Subscription & Payment'),
            url: '/wallet',
            icon: Wallet,
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('渠道测试场'),
            url: '/channel-lab',
            icon: FlaskConical,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            title: t('Subscription Management'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          {
            title: t('Profit Monitor'),
            url: '/profit-monitor',
            icon: ChartColumnIncreasing,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/general/system-info',
            activeUrls: ['/system-settings'],
            icon: Settings,
          },
        ],
      },
    ],
  }
}
