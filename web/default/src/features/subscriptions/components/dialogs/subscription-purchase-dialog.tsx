import * as React from 'react'
import { Crown, CalendarClock, Package, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { quotaUnitsToDollars } from '@/lib/format'
import { purchaseSubscriptionWithWallet } from '../../api'
import { formatDuration, formatPlanLimit } from '../../lib'
import type { PlanRecord } from '../../types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanRecord | null
  currentBalance?: number
  purchaseLimit?: number
  purchaseCount?: number
  onPurchased?: () => Promise<void> | void
}

export function SubscriptionPurchaseDialog(props: Props) {
  const { t } = useTranslation()
  const [paying, setPaying] = React.useState(false)

  const plan = props.plan?.plan
  if (!plan) return null

  const totalAmount = Number(plan.total_amount || 0)
  const currentBalance = Number(props.currentBalance || 0)
  const price = Number(plan.price_amount || 0)
  const limitReached =
    (props.purchaseLimit || 0) > 0 &&
    (props.purchaseCount || 0) >= (props.purchaseLimit || 0)
  const balanceSufficient = currentBalance >= price

  const handlePurchase = async () => {
    setPaying(true)
    try {
      const res = await purchaseSubscriptionWithWallet(plan.id)
      if (res.success || res.message === 'success') {
        toast.success(t('Subscription purchased successfully'))
        props.onOpenChange(false)
        await props.onPurchased?.()
      } else {
        toast.error(res.message || t('Purchase failed'))
      }
    } catch {
      toast.error(t('Purchase failed'))
    } finally {
      setPaying(false)
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Crown className='h-5 w-5' />
            {t('Purchase Subscription')}
          </DialogTitle>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='bg-muted/50 space-y-3 rounded-lg border p-4'>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Plan Name')}
              </span>
              <span className='max-w-[200px] truncate text-sm font-medium'>
                {plan.title}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Validity Period')}
              </span>
              <span className='flex items-center gap-1 text-sm'>
                <CalendarClock className='h-3.5 w-3.5' />
                {formatDuration(plan, t)}
              </span>
            </div>
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Included Balance')}
              </span>
              <span className='flex items-center gap-1 text-sm'>
                <Package className='h-3.5 w-3.5' />
                {totalAmount > 0
                  ? `$${quotaUnitsToDollars(totalAmount).toFixed(2)}`
                  : t('Unlimited')}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('5-Hour Limit')}
              </span>
              <span className='text-sm'>
                {formatPlanLimit(plan, 'five_hour_amount', t)}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Daily Limit')}
              </span>
              <span className='text-sm'>
                {formatPlanLimit(plan, 'daily_amount', t)}
              </span>
            </div>
            <div className='flex justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Weekly Limit')}
              </span>
              <span className='text-sm'>
                {formatPlanLimit(plan, 'weekly_amount', t)}
              </span>
            </div>
            {plan.upgrade_group && (
              <div className='flex justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Upgrade Group')}
                </span>
                <span className='text-sm'>{plan.upgrade_group}</span>
              </div>
            )}
            <div className='flex items-center justify-between'>
              <span className='text-muted-foreground text-sm'>
                {t('Current Balance')}
              </span>
              <span className='flex items-center gap-1 text-sm'>
                <Wallet className='h-3.5 w-3.5' />${currentBalance.toFixed(2)}
              </span>
            </div>
            <Separator />
            <div className='flex items-center justify-between'>
              <span className='text-sm font-medium'>{t('Deduct Balance')}</span>
              <span className='text-primary text-lg font-bold'>
                ${price.toFixed(2)}
              </span>
            </div>
          </div>

          {limitReached && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('Purchase limit reached')} ({props.purchaseCount}/
                {props.purchaseLimit})
              </AlertDescription>
            </Alert>
          )}

          {!balanceSufficient && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t('Insufficient balance. Please add funds first.')}
              </AlertDescription>
            </Alert>
          )}

          <Button
            className='w-full'
            onClick={handlePurchase}
            disabled={paying || limitReached || !balanceSufficient}
          >
            {t('Confirm Subscription')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
