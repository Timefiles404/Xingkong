import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { deletePlan } from '../../api'
import { useSubscriptions } from '../subscriptions-provider'

export function DeletePlanDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh, setCurrentRow } =
    useSubscriptions()
  const [loading, setLoading] = useState(false)

  if (open !== 'delete' || !currentRow) return null

  const handleConfirm = async () => {
    setLoading(true)
    try {
      const res = await deletePlan(currentRow.plan.id)
      if (res.success) {
        toast.success(t('Plan deleted successfully'))
        triggerRefresh()
        setCurrentRow(null)
        setOpen(null)
      } else {
        toast.error(res.message || t('Failed to delete plan'))
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('Failed to delete plan')
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setCurrentRow(null)
          setOpen(null)
        }
      }}
      title={t('Delete Plan?')}
      desc={t(
        'This will permanently delete the plan when it has no active subscriptions. This action cannot be undone.'
      )}
      confirmText={t('Delete')}
      handleConfirm={handleConfirm}
      isLoading={loading}
      destructive
    />
  )
}
