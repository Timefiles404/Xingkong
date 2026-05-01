import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMediaQuery } from '@/hooks'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DataTablePagination,
  TableSkeleton,
  TableEmpty,
  MobileCardList,
} from '@/components/data-table'
import { PageFooterPortal } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { getAdminPlans, getPlanSubscribers } from '../api'
import { formatLimitAmount, formatTimestamp } from '../lib'
import type { PlanSubscriberRecord } from '../types'
import { useSubscriptionsColumns } from './subscriptions-columns'
import { useSubscriptions } from './subscriptions-provider'

function PlanSubscribersPanel({
  planId,
  refreshTrigger,
}: {
  planId: number
  refreshTrigger: number
}) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-subscription-plan-subscribers', planId, refreshTrigger],
    queryFn: async () => {
      const result = await getPlanSubscribers(planId)
      return result.data || []
    },
    enabled: planId > 0,
    staleTime: 30_000,
  })

  const members = data || []

  if (isLoading) {
    return (
      <div className='px-4 py-3 text-sm text-muted-foreground'>
        {t('Loading subscribers...')}
      </div>
    )
  }

  if (members.length === 0) {
    return (
      <div className='px-4 py-3 text-sm text-muted-foreground'>
        {t('No subscribed users yet')}
      </div>
    )
  }

  return (
    <div className='space-y-3 px-4 py-3'>
      <div className='grid grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,0.8fr))_minmax(0,0.9fr)_minmax(0,1fr)] gap-3 text-xs font-medium text-muted-foreground'>
        <div>{t('User')}</div>
        <div>{t('Total Used')}</div>
        <div>{t('5-Hour Usage')}</div>
        <div>{t('Daily Usage')}</div>
        <div>{t('Weekly Usage')}</div>
        <div>{t('Remaining')}</div>
        <div>{t('Status')}</div>
      </div>
      {members.map((record: PlanSubscriberRecord) => {
        const member = record.member
        const isActive =
          member.status === 'active' && Number(member.end_time || 0) * 1000 > Date.now()
        return (
          <div
            key={member.subscription_id}
            className='grid grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,0.8fr))_minmax(0,0.9fr)_minmax(0,1fr)] gap-3 rounded-xl border bg-background/80 px-3 py-3 text-sm'
          >
            <div className='min-w-0'>
              <div className='truncate font-medium'>{member.username || `#${member.user_id}`}</div>
              <div className='truncate text-xs text-muted-foreground'>
                {t('Subscription')} #{member.subscription_id} · {formatTimestamp(member.end_time)}
              </div>
            </div>
            <div>{formatLimitAmount(member.amount_used, t)}</div>
            <div>{formatLimitAmount(member.five_hour_usage, t)}</div>
            <div>{formatLimitAmount(member.daily_usage, t)}</div>
            <div>{formatLimitAmount(member.weekly_usage, t)}</div>
            <div>{formatLimitAmount(member.remaining_amount, t)}</div>
            <div>
              <StatusBadge
                label={isActive ? t('Active') : t(member.status || 'Unknown')}
                variant={isActive ? 'success' : 'neutral'}
                copyable={false}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function SubscriptionsTable() {
  const { t } = useTranslation()
  const { refreshTrigger } = useSubscriptions()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [expandedPlanIds, setExpandedPlanIds] = useState<Set<number>>(new Set())

  const togglePlan = (planId: number) => {
    setExpandedPlanIds((prev) => {
      const next = new Set(prev)
      if (next.has(planId)) {
        next.delete(planId)
      } else {
        next.add(planId)
      }
      return next
    })
  }

  const columns = useSubscriptionsColumns(expandedPlanIds, togglePlan)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-subscription-plans', refreshTrigger],
    queryFn: async () => {
      const result = await getAdminPlans()
      return result.data || []
    },
    placeholderData: (prev) => prev,
  })

  const plans = useMemo(() => data || [], [data])

  const table = useReactTable({
    data: plans,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <>
      <div className='space-y-4'>
        {isMobile ? (
          <MobileCardList
            table={table}
            isLoading={isLoading}
            emptyTitle={t('No subscription plans yet')}
            emptyDescription={t(
              'Click "Create Plan" to create your first subscription plan'
            )}
          />
        ) : (
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableSkeleton
                    table={table}
                    keyPrefix='subscriptions-skeleton'
                  />
                ) : table.getRowModel().rows.length === 0 ? (
                  <TableEmpty
                    colSpan={columns.length}
                    title={t('No subscription plans yet')}
                    description={t(
                      'Click "Create Plan" to create your first subscription plan'
                    )}
                  />
                ) : (
                  table.getRowModel().rows.map((row) => {
                    const planId = row.original.plan.id
                    const expanded = expandedPlanIds.has(planId)
                    return (
                      <Fragment key={row.id}>
                        <TableRow
                          className={cn('cursor-pointer', expanded && 'bg-muted/20')}
                          onClick={() => togglePlan(planId)}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                        {expanded && (
                          <TableRow className='bg-muted/10 hover:bg-muted/10'>
                            <TableCell colSpan={row.getVisibleCells().length} className='p-0'>
                              <PlanSubscribersPanel
                                planId={planId}
                                refreshTrigger={refreshTrigger}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <PageFooterPortal>
        <DataTablePagination table={table} />
      </PageFooterPortal>
    </>
  )
}
