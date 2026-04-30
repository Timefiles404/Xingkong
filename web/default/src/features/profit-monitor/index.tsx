import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import {
  ArrowRightLeft,
  BadgeDollarSign,
  ChartNoAxesCombined,
  ShieldAlert,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/context/theme-provider'
import { SectionPageLayout } from '@/components/layout'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { VCHART_OPTION } from '@/lib/vchart'
import { getProfitOverview } from './api'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

const periodOptions = [
  { value: 'day', labelKey: 'Today' },
  { value: 'week', labelKey: '7 Days' },
  { value: 'month', labelKey: '30 Days' },
] as const

const metricOptions = [
  { value: 'operating', labelKey: 'Operating Profit' },
  { value: 'gross', labelKey: 'Gross Profit' },
  { value: 'cashflow', labelKey: 'Cash Flow' },
] as const

function formatCNY(value: number) {
  return `¥ ${Number(value || 0).toFixed(2)}`
}

function buildTrendSpec(
  data: Array<{
    time: string
    operating_profit: number
    gross_profit: number
    cash_flow: number
  }>,
  metric: (typeof metricOptions)[number]['value']
) {
  const valueKey =
    metric === 'gross'
      ? 'gross_profit'
      : metric === 'cashflow'
        ? 'cash_flow'
        : 'operating_profit'

  return {
    type: 'line',
    data: [
      {
        id: 'profit',
        values: data.map((item) => ({
          time: item.time,
          value: Number(item[valueKey] || 0),
        })),
      },
    ],
    xField: 'time',
    yField: 'value',
    seriesField: 'id',
    padding: [18, 12, 32, 44],
    legends: { visible: false },
    axes: [
      {
        orient: 'bottom',
        type: 'band',
        label: { visible: true },
        grid: { visible: false },
      },
      {
        orient: 'left',
        type: 'linear',
        label: { visible: true },
        grid: { visible: true },
      },
    ],
    line: { style: { lineWidth: 3 } },
    point: {
      visible: true,
      style: {
        size: 6,
      },
    },
    tooltip: { visible: true },
  }
}

function buildParameterSpec(
  data: Array<{
    time: string
    downstream: number
    upstream: number
    fee: number
  }>,
  labels: {
    downstream: string
    upstream: string
    fee: string
  }
) {
  return {
    type: 'line',
    data: [
      {
        id: labels.downstream,
        values: data.map((item) => ({
          time: item.time,
          value: Number(item.downstream || 0),
        })),
      },
      {
        id: labels.upstream,
        values: data.map((item) => ({
          time: item.time,
          value: Number(item.upstream || 0),
        })),
      },
      {
        id: labels.fee,
        values: data.map((item) => ({
          time: item.time,
          value: Number(item.fee || 0),
        })),
      },
    ],
    xField: 'time',
    yField: 'value',
    seriesField: 'id',
    legends: { visible: true, orient: 'top' },
    padding: [18, 12, 40, 44],
    axes: [
      { orient: 'bottom', type: 'band' },
      { orient: 'left', type: 'linear' },
    ],
    line: { style: { lineWidth: 2.5 } },
    point: { visible: true, style: { size: 5 } },
    tooltip: { visible: true },
  }
}

export function ProfitMonitor() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)
  const [period, setPeriod] =
    useState<(typeof periodOptions)[number]['value']>('day')
  const [metric, setMetric] =
    useState<(typeof metricOptions)[number]['value']>('operating')

  const { data, isLoading } = useQuery({
    queryKey: ['profit-overview', period],
    queryFn: () => getProfitOverview(period),
  })

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }
    updateTheme()
  }, [resolvedTheme])

  const overview = data?.data

  const summaryCards = useMemo(
    () => [
      {
        key: 'business_profit',
        icon: BadgeDollarSign,
        titleKey: 'Operating Profit',
        descriptionKey: 'Primary natural-day operating profit indicator',
        value: formatCNY(overview?.summary?.operating_profit_cny || 0),
      },
      {
        key: 'gross_profit',
        icon: Wallet,
        titleKey: 'Gross Profit',
        descriptionKey: 'Request revenue minus upstream cost only',
        value: formatCNY(overview?.summary?.gross_profit_cny || 0),
      },
      {
        key: 'cashflow',
        icon: ArrowRightLeft,
        titleKey: 'Cash Flow',
        descriptionKey: 'Today gross inflow minus cash outflow',
        value: formatCNY(overview?.summary?.cash_flow_cny || 0),
      },
      {
        key: 'liability',
        icon: ShieldAlert,
        titleKey: 'Outstanding Liability',
        descriptionKey: 'Wallet and subscription value not yet realized',
        value: formatCNY(overview?.summary?.outstanding_liability_cny || 0),
      },
    ],
    [overview]
  )

  const trendSpec = useMemo(
    () => buildTrendSpec(overview?.trend || [], metric),
    [metric, overview]
  )
  const parameterSpec = useMemo(
    () =>
      buildParameterSpec(overview?.parameter_trend || [], {
        downstream: t('Downstream Exchange Rate'),
        upstream: t('Upstream Exchange Rate'),
        fee: t('Payment Fee Rate'),
      }),
    [overview, t]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Profit Monitor')}</SectionPageLayout.Title>
      <SectionPageLayout.Description>
        {t(
          'Operational profit workspace for daily profit, liabilities, trend diagnostics, and drill-down accounting chains.'
        )}
      </SectionPageLayout.Description>
      <SectionPageLayout.Content>
        <div className='space-y-6'>
          <Card className='overflow-hidden'>
            <CardHeader className='gap-3 md:flex-row md:items-start md:justify-between'>
              <div className='space-y-2'>
                <Badge variant='secondary'>
                  {t('Natural-Day Accounting')}
                </Badge>
                <CardTitle className='text-2xl'>
                  {t('Operating profit is the primary metric')}
                </CardTitle>
                <CardDescription className='max-w-3xl text-sm leading-6'>
                  {t(
                    'This workspace now reads from wallet lots, subscription lots, usage settlements, finance ledgers, and breakage settlements. Historical rows keep their own exchange-rate and pricing snapshots instead of being recalculated with current settings.'
                  )}
                </CardDescription>
              </div>
              <div className='bg-muted/60 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm'>
                <ChartNoAxesCombined className='h-4 w-4' />
                <span>{t('Ledger-backed profitability view')}</span>
              </div>
            </CardHeader>
          </Card>

          <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
            {summaryCards.map((item) => {
              const Icon = item.icon
              return (
                <Card key={item.key}>
                  <CardHeader className='space-y-3'>
                    <div className='bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-xl'>
                      <Icon className='h-5 w-5' />
                    </div>
                    <div className='space-y-1'>
                      <CardTitle className='text-base'>
                        {t(item.titleKey)}
                      </CardTitle>
                      <CardDescription>{t(item.descriptionKey)}</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className='text-3xl font-semibold tracking-tight'>
                      {item.value}
                    </div>
                    <p className='text-muted-foreground mt-2 text-xs'>
                      {isLoading
                        ? t('Loading...')
                        : t('Aggregated from the selected accounting period')}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className='grid gap-4 xl:grid-cols-[1.4fr_1fr]'>
            <Card>
              <CardHeader className='gap-4 lg:flex-row lg:items-center lg:justify-between'>
                <div>
                  <CardTitle>{t('Profit Trend')}</CardTitle>
                  <CardDescription>
                    {t(
                      'Aligned with dashboard model-call analytics, but focused on profit-oriented metrics.'
                    )}
                  </CardDescription>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <div className='bg-muted/60 inline-flex h-8 rounded-md border p-0.5'>
                    {periodOptions.map((item) => (
                      <button
                        key={item.value}
                        type='button'
                        onClick={() => setPeriod(item.value)}
                        className={`rounded-[5px] px-3 text-xs font-medium transition-colors ${
                          period === item.value
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t(item.labelKey)}
                      </button>
                    ))}
                  </div>
                  <div className='bg-muted/60 inline-flex h-8 rounded-md border p-0.5'>
                    {metricOptions.map((item) => (
                      <button
                        key={item.value}
                        type='button'
                        onClick={() => setMetric(item.value)}
                        className={`rounded-[5px] px-3 text-xs font-medium transition-colors ${
                          metric === item.value
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t(item.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className='h-[360px]'>
                {themeReady && (
                  <VChart
                    key={`profit-trend-${period}-${metric}-${resolvedTheme}`}
                    spec={{
                      ...trendSpec,
                      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                      background: 'transparent',
                    }}
                    option={VCHART_OPTION}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('Current Period Snapshot')}</CardTitle>
                <CardDescription>
                  {t(
                    'All values below are cumulative within the currently selected period and are separated by accounting role.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                {[
                  {
                    label: 'Realized Request Revenue',
                    value: overview?.summary?.revenue_cny || 0,
                  },
                  {
                    label: 'Upstream Cost',
                    value: overview?.summary?.upstream_cost_cny || 0,
                  },
                  {
                    label: 'Breakage Revenue',
                    value: overview?.summary?.breakage_cny || 0,
                  },
                  {
                    label: 'Finance and Operating Cost',
                    value: overview?.summary?.finance_cost_cny || 0,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className='bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2'
                  >
                    <span>{t(item.label)}</span>
                    <span className='font-medium'>{formatCNY(item.value)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className='grid gap-4 xl:grid-cols-[1.2fr_1.2fr]'>
            <Card>
              <CardHeader>
                <CardTitle>{t('Variable Parameter Trend')}</CardTitle>
                <CardDescription>
                  {t(
                    'Track exchange-rate and fee fluctuations that can materially change operating profit.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className='h-[320px]'>
                {themeReady && (
                  <VChart
                    key={`profit-parameters-${period}-${resolvedTheme}`}
                    spec={{
                      ...parameterSpec,
                      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                      background: 'transparent',
                    }}
                    option={VCHART_OPTION}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('Accounting Boundaries')}</CardTitle>
                <CardDescription>
                  {t(
                    'These rules are intentionally conservative to avoid showing fake profit.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                {[
                  'No cash withdrawal is allowed, so wallet balance remains a liability until consumed.',
                  'Wallet balance has no expiry, so unused wallet balance cannot be recognized as breakage.',
                  'Subscription expiry immediately forfeits remaining entitlement and can be recognized as breakage when enabled.',
                  'Subscription cancellation returns remaining value to wallet liability instead of treating it as profit reduction.',
                ].map((item) => (
                  <div
                    key={item}
                    className='bg-muted/30 rounded-lg border p-3 leading-6'
                  >
                    {t(item)}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('Full-Chain Detail')}</CardTitle>
              <CardDescription>
                {t(
                  'Expandable accounting drill-down for the selected period. Each block shows cumulative values already realized in this time range.'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type='single' collapsible className='w-full'>
                {(overview?.chains || []).map((group) => (
                  <AccordionItem value={group.key} key={group.key}>
                    <AccordionTrigger className='hover:no-underline'>
                      <div className='space-y-1 text-start'>
                        <div className='font-medium'>{t(group.label)}</div>
                        <div className='text-muted-foreground text-sm'>
                          {t('Cumulative values inside the current period')}
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className='space-y-3 text-sm'>
                        {group.items.map((item) => (
                          <div
                            key={item.key}
                            className='bg-muted/30 flex items-center justify-between rounded-lg border p-3 leading-6'
                          >
                            <span>{t(item.label)}</span>
                            <span className='font-medium'>
                              {formatCNY(item.value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
