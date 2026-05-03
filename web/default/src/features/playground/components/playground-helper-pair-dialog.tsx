import { CopyIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface PlaygroundHelperPairDialogProps {
  open: boolean
  code: string
  manualCommand: string
  isPairing: boolean
  onOpenChange: (open: boolean) => void
  onCodeChange: (code: string) => void
  onPair: (code: string) => void
  onCopyManualCommand: () => void
}

export function PlaygroundHelperPairDialog({
  open,
  code,
  manualCommand,
  isPairing,
  onOpenChange,
  onCodeChange,
  onPair,
  onCopyManualCommand,
}: PlaygroundHelperPairDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Pair local helper')}</DialogTitle>
          <DialogDescription>
            {t(
              'Enter the pairing code printed in the local helper window. The web page never generates this code.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <Input
            autoFocus
            inputMode='numeric'
            maxLength={16}
            onChange={(event) =>
              onCodeChange(event.target.value.replace(/\s+/g, ''))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onPair(code)
              }
            }}
            placeholder={t('Helper pairing code')}
            value={code}
          />
          {manualCommand && (
            <button
              className='text-muted-foreground flex min-w-0 items-center gap-2 text-left text-xs hover:text-foreground'
              onClick={onCopyManualCommand}
              type='button'
            >
              <CopyIcon className='size-3.5 shrink-0' />
              <span className='truncate'>
                {t('Manual start command')}: {manualCommand}
              </span>
            </button>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type='button'
            variant='outline'
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={isPairing || !code.trim()}
            onClick={() => onPair(code)}
            type='button'
          >
            {isPairing ? t('Pairing helper') : t('Pair helper')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
