import { memo, useCallback, useEffect, useState } from 'react'
import { Activity, RotateCw } from 'lucide-react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getModelAvailability } from '@/features/dashboard/api'
import type {
  ModelAvailabilityBucket,
  ModelAvailabilityItem,
  ModelAvailabilityResponse,
  ModelAvailabilityStat,
  ModelAvailabilityView,
} from '@/features/dashboard/types'
import { PanelWrapper } from '../ui/panel-wrapper'

const VIEW_OPTIONS: Array<{
  value: ModelAvailabilityView
  labelKey: string
}> = [
  { value: 'minute', labelKey: 'Minute' },
  { value: 'half_hour', labelKey: 'Half Hour' },
  { value: 'hour', labelKey: 'Hour' },
  { value: 'day', labelKey: 'Day' },
]

const SUMMARY_ITEMS: Array<{
  key: keyof ModelAvailabilityItem['summary']
  labelKey: string
}> = [
  { key: 'last_10_minutes', labelKey: '10m' },
  { key: 'last_30_minutes', labelKey: '30m' },
  { key: 'last_1_hour', labelKey: '1h' },
  { key: 'today', labelKey: 'Today' },
]

const AVAILABILITY_COLOR_MAP = {
  noData: 'bg-muted',
  excellent: 'bg-sky-500',
  strong: 'bg-emerald-500',
  good: 'bg-lime-400',
  fair: 'bg-amber-500',
  weak: 'bg-red-500',
  poor: 'bg-rose-900',
}

const AvailabilityCell = memo(function AvailabilityCell(props: {
  bucket: ModelAvailabilityBucket
}) {
  const { t } = useTranslation()
  const { bucket } = props
  const startAt = new Date(bucket.start_at * 1000).toLocaleString()
  const endAt = new Date(bucket.end_at * 1000).toLocaleString()
  const text =
    bucket.total > 0
      ? `${(bucket.availability * 100).toFixed(1)}% (${bucket.success}/${bucket.total})`
      : t('No data')

  return (
    <div
      title={`${startAt} - ${endAt}: ${text}`}
      className={cn(
        'h-8 min-w-0 rounded-[3px]',
        getAvailabilityColor(bucket.availability)
      )}
    />
  )
})

const SummaryBadge = memo(function SummaryBadge(props: {
  label: string
  stat: ModelAvailabilityStat
}) {
  return (
    <div className='bg-muted/40 rounded-md px-2.5 py-2'>
      <div className='text-muted-foreground text-[11px]'>{props.label}</div>
      <div className='mt-1 text-sm font-semibold'>
        {formatAvailability(props.stat.success, props.stat.total)}
      </div>
    </div>
  )
})

export function UptimePanel() {
  const { t } = useTranslation()
  const [view, setView] = useState<ModelAvailabilityView>('half_hour')
  const [data, setData] = useState<ModelAvailabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = useCallback(
    async (silent: boolean, targetView: ModelAvailabilityView) => {
      if (silent) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      try {
        const res = await getModelAvailability(targetView)
        setData(res?.data || null)
      } catch {
        setData(null)
      } finally {
        if (silent) {
          setRefreshing(false)
        } else {
          setLoading(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void loadData(false, view)
  }, [loadData, view])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadData(true, view)
    }, 60 * 1000)
    return () => window.clearInterval(timer)
  }, [loadData, view])

  const handleRefresh = () => {
    void loadData(true, view)
  }

  return (
    <PanelWrapper
      title={
        <span className='flex items-center gap-2'>
          <Activity className='text-muted-foreground/60 size-4' />
          {t('Status Monitoring')}
        </span>
      }
      loading={loading}
      empty={!data?.models?.length}
      emptyMessage={t('No model usage data yet')}
      height='h-[32rem]'
      headerActions={
        <div className='flex items-center gap-2'>
          <div className='hidden items-center gap-1 md:flex'>
            {VIEW_OPTIONS.map((option) => (
              <Button
                key={option.value}
                variant={view === option.value ? 'secondary' : 'ghost'}
                size='sm'
                className='h-7 px-2 text-xs'
                onClick={() => setView(option.value)}
              >
                {t(option.labelKey)}
              </Button>
            ))}
          </div>
          <Button
            variant='ghost'
            size='sm'
            onClick={handleRefresh}
            disabled={refreshing}
            className='size-7 p-0'
          >
            <RotateCw
              className={cn('size-3.5', refreshing && 'animate-spin')}
              aria-label={t('Refresh')}
            />
          </Button>
        </div>
      }
    >
      <div className='mb-4 flex flex-wrap gap-1 md:hidden'>
        {VIEW_OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={view === option.value ? 'secondary' : 'outline'}
            size='sm'
            className='h-7 px-2 text-xs'
            onClick={() => setView(option.value)}
          >
            {t(option.labelKey)}
          </Button>
        ))}
      </div>

      <div className='mb-4 flex flex-wrap items-center gap-3 text-xs'>
        <div className='text-muted-foreground'>
          {t('Each block represents one {{interval}} bucket', {
            interval: t(getViewIntervalLabel(view)),
          })}
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          {renderLegend(t)}
        </div>
      </div>

      <ScrollArea className='h-[27rem]'>
        <div className='space-y-4 pr-1'>
          {data?.models?.map((item) => (
            <div key={item.model_name} className='rounded-lg border p-3'>
              <div className='mb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between'>
                <div className='min-w-0'>
                  <div className='truncate text-sm font-semibold'>
                    {item.model_name}
                  </div>
                  <div className='text-muted-foreground mt-1 text-xs'>
                    {t('Selected range success rate')}:{' '}
                    {formatAvailability(item.successful, item.total)}
                  </div>
                </div>
                <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
                  {SUMMARY_ITEMS.map((summaryItem) => (
                    <SummaryBadge
                      key={summaryItem.key}
                      label={t(summaryItem.labelKey)}
                      stat={item.summary[summaryItem.key]}
                    />
                  ))}
                </div>
              </div>

              <div
                className='grid gap-1'
                style={{
                  gridTemplateColumns: `repeat(${item.series.length}, minmax(0, 1fr))`,
                }}
              >
                {item.series.map((bucket) => (
                  <AvailabilityCell
                    key={`${item.model_name}-${bucket.start_at}`}
                    bucket={bucket}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </PanelWrapper>
  )
}

function formatAvailability(success: number, total: number) {
  if (total <= 0) {
    return '--'
  }
  return `${((success / total) * 100).toFixed(1)}%`
}

function getViewIntervalLabel(view: ModelAvailabilityView) {
  switch (view) {
    case 'minute':
      return '1 minute'
    case 'half_hour':
      return '30 minutes'
    case 'hour':
      return '1 hour'
    case 'day':
      return '1 day'
    default:
      return '30 minutes'
  }
}

function getAvailabilityColor(availability: number) {
  if (availability < 0) {
    return AVAILABILITY_COLOR_MAP.noData
  }
  if (availability >= 0.98) {
    return AVAILABILITY_COLOR_MAP.excellent
  }
  if (availability >= 0.9) {
    return AVAILABILITY_COLOR_MAP.strong
  }
  if (availability >= 0.8) {
    return AVAILABILITY_COLOR_MAP.good
  }
  if (availability >= 0.5) {
    return AVAILABILITY_COLOR_MAP.fair
  }
  if (availability >= 0.3) {
    return AVAILABILITY_COLOR_MAP.weak
  }
  return AVAILABILITY_COLOR_MAP.poor
}

function renderLegend(t: TFunction) {
  const items = [
    { color: AVAILABILITY_COLOR_MAP.excellent, label: t('98%+') },
    { color: AVAILABILITY_COLOR_MAP.strong, label: t('90%+') },
    { color: AVAILABILITY_COLOR_MAP.good, label: t('80%+') },
    { color: AVAILABILITY_COLOR_MAP.fair, label: t('50%+') },
    { color: AVAILABILITY_COLOR_MAP.weak, label: t('30%+') },
    { color: AVAILABILITY_COLOR_MAP.poor, label: t('Below 30%') },
    { color: AVAILABILITY_COLOR_MAP.noData, label: t('No data') },
  ]

  return items.map((item) => (
    <span key={item.label} className='flex items-center gap-1.5'>
      <span className={cn('inline-block size-2.5 rounded-sm', item.color)} />
      <span className='text-muted-foreground'>{item.label}</span>
    </span>
  ))
}
