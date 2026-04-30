import { useState, useCallback, useMemo } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionPageLayout } from '@/components/layout'
import {
  CardStaggerContainer,
  CardStaggerItem,
  FadeIn,
} from '@/components/page-transition'
import { ConsumptionDistributionChart } from './components/models/consumption-distribution-chart'
import { LogStatCards } from './components/models/log-stat-cards'
import { ModelCharts } from './components/models/model-charts'
import { ModelsFilter } from './components/models/models-filter-dialog'
import { AnnouncementsPanel } from './components/overview/announcements-panel'
import { ApiInfoPanel } from './components/overview/api-info-panel'
import { SummaryCards } from './components/overview/summary-cards'
import { UptimePanel } from './components/overview/uptime-panel'
import { UserCharts } from './components/users/user-charts'
import { DEFAULT_TIME_GRANULARITY } from './constants'
import {
  type DashboardSectionId,
  DASHBOARD_DEFAULT_SECTION,
  DASHBOARD_SECTION_IDS,
} from './section-registry'
import { type DashboardFilters, type QuotaDataItem } from './types'

const route = getRouteApi('/_authenticated/dashboard/$section')

const SECTION_META: Record<
  DashboardSectionId,
  { titleKey: string; descriptionKey: string }
> = {
  overview: {
    titleKey: 'Overview',
    descriptionKey: 'View dashboard overview and statistics',
  },
  models: {
    titleKey: 'Model Call Analytics',
    descriptionKey: 'View model call count analytics and charts',
  },
  users: {
    titleKey: 'User Analytics',
    descriptionKey: 'View user consumption statistics and charts',
  },
}

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = route.useParams()
  const userRole = useAuthStore((state) => state.auth.user?.role)
  const activeSection = (params.section ??
    DASHBOARD_DEFAULT_SECTION) as DashboardSectionId

  const [modelFilters, setModelFilters] = useState<DashboardFilters>({})
  const [modelData, setModelData] = useState<QuotaDataItem[]>([])
  const [dataLoading, setDataLoading] = useState(false)

  const handleFilterChange = useCallback((filters: DashboardFilters) => {
    setModelFilters(filters)
  }, [])

  const handleResetFilters = useCallback(() => {
    setModelFilters({})
  }, [])

  const handleDataUpdate = useCallback(
    (data: QuotaDataItem[], loading: boolean) => {
      setModelData(data)
      setDataLoading(loading)
    },
    []
  )

  const meta = SECTION_META[activeSection] ?? SECTION_META.overview
  const isAdmin = Boolean(userRole && userRole >= ROLE.ADMIN)
  const visibleSections = useMemo(
    () =>
      DASHBOARD_SECTION_IDS.filter(
        (section) => section !== 'overview' && (section !== 'users' || isAdmin)
      ),
    [isAdmin]
  )
  const handleSectionChange = useCallback(
    (section: string) => {
      void navigate({
        to: '/dashboard/$section',
        params: { section: section as DashboardSectionId },
      })
    },
    [navigate]
  )
  const showSectionTabs = activeSection !== 'overview' && visibleSections.length > 1

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t(meta.titleKey)}</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        {t(meta.descriptionKey)}
      </SectionPageLayout.Description>
      {activeSection === 'models' && (
        <SectionPageLayout.Actions>
          <ModelsFilter
            onFilterChange={handleFilterChange}
            onReset={handleResetFilters}
          />
        </SectionPageLayout.Actions>
      )}
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          {showSectionTabs && (
            <Tabs value={activeSection} onValueChange={handleSectionChange}>
              <TabsList className='h-auto max-w-full flex-wrap justify-start'>
                {visibleSections.map((section) => (
                  <TabsTrigger key={section} value={section}>
                    {t(SECTION_META[section].titleKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          {activeSection === 'overview' && (
            <>
              <SummaryCards />
              <CardStaggerContainer className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
                <CardStaggerItem>
                  <ApiInfoPanel />
                </CardStaggerItem>
                <CardStaggerItem>
                  <AnnouncementsPanel />
                </CardStaggerItem>
                <CardStaggerItem className='lg:col-span-2'>
                  <UptimePanel />
                </CardStaggerItem>
              </CardStaggerContainer>
            </>
          )}
          {activeSection === 'models' && (
            <>
              <FadeIn>
                <LogStatCards
                  filters={modelFilters}
                  onDataUpdate={handleDataUpdate}
                />
              </FadeIn>
              <FadeIn delay={0.1}>
                <ConsumptionDistributionChart
                  data={modelData}
                  loading={dataLoading}
                  timeGranularity={
                    modelFilters.time_granularity || DEFAULT_TIME_GRANULARITY
                  }
                />
              </FadeIn>
              <FadeIn delay={0.15}>
                <ModelCharts
                  data={modelData}
                  loading={dataLoading}
                  timeGranularity={
                    modelFilters.time_granularity || DEFAULT_TIME_GRANULARITY
                  }
                />
              </FadeIn>
            </>
          )}
          {activeSection === 'users' && (
            <FadeIn>
              <UserCharts />
            </FadeIn>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
