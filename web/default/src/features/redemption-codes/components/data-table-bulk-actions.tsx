import { useState, useMemo } from 'react'
import { type Table } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { deleteRedemption } from '../api'
import { type Redemption } from '../types'
import { useRedemptions } from './redemptions-provider'

type DataTableBulkActionsProps<TData> = {
  table: Table<TData>
}

export function DataTableBulkActions<TData>({
  table,
}: DataTableBulkActionsProps<TData>) {
  const { t } = useTranslation()
  const { triggerRefresh } = useRedemptions()
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] =
    useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const selectedRows = table.getFilteredSelectedRowModel().rows

  const contentToCopy = useMemo(() => {
    const selectedCodes = selectedRows.map((row) => {
      const redemption = row.original as Redemption
      return `${redemption.name}\t${redemption.key}`
    })
    return selectedCodes.join('\n')
  }, [selectedRows])

  const handleDeleteSelected = async () => {
    setIsDeleting(true)
    try {
      const redemptions = selectedRows.map((row) => row.original as Redemption)
      const results = await Promise.allSettled(
        redemptions.map((redemption) => deleteRedemption(redemption.id))
      )

      const successCount = results.filter(
        (result) => result.status === 'fulfilled' && result.value.success
      ).length

      if (successCount > 0) {
        toast.success(
          t('Successfully deleted {{count}} redemption codes', {
            count: successCount,
          })
        )
      }

      if (successCount !== redemptions.length) {
        toast.error(t('Batch delete failed'))
      }

      table.resetRowSelection()
      triggerRefresh()
      setShowDeleteSelectedConfirm(false)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <>
      <BulkActionsToolbar table={table} entityName={t('redemption code')}>
        <CopyButton
          value={contentToCopy}
          variant='outline'
          size='icon'
          className='size-8'
          tooltip={t('Copy selected codes')}
          successTooltip={t('Codes copied!')}
          aria-label={t('Copy selected codes')}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='destructive'
              size='icon'
              onClick={() => setShowDeleteSelectedConfirm(true)}
              className='size-8'
              aria-label={t('Delete selected redemption codes')}
              title={t('Delete selected redemption codes')}
            >
              <Trash2 />
              <span className='sr-only'>{t('Delete selected')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('Delete selected redemption codes')}</p>
          </TooltipContent>
        </Tooltip>
      </BulkActionsToolbar>

      <ConfirmDialog
        destructive
        open={showDeleteSelectedConfirm}
        onOpenChange={setShowDeleteSelectedConfirm}
        handleConfirm={handleDeleteSelected}
        isLoading={isDeleting}
        className='max-w-md'
        title={t('Delete Selected Redemption Codes?')}
        desc={
          <>
            {t('This will permanently delete {{count}} selected redemption codes.', {
              count: selectedRows.length,
            })}
            <br />
            {t('This action cannot be undone.')}
          </>
        }
        confirmText={t('Delete selected')}
      />
    </>
  )
}
