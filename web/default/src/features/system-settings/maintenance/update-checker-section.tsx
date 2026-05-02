import { useState } from 'react'
import { ExternalLinkIcon, RefreshCcwIcon, RocketIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatTimestamp, formatTimestampToDate } from '@/lib/format'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Markdown } from '@/components/ui/markdown'
import { applySystemUpdate, checkSystemUpdate } from '../api'
import { SettingsSection } from '../components/settings-section'

type ReleaseInfo = {
  tag_name: string
  name?: string
  body?: string
  html_url?: string
  published_at?: string
}

type UpdateCheckerSectionProps = {
  currentVersion?: string | null
  startTime?: number | null
}

export function UpdateCheckerSection({
  currentVersion,
  startTime,
}: UpdateCheckerSectionProps) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{
    repository: string
    image: string
    has_update: boolean
    can_auto_update: boolean
    auto_update_hint?: string
  } | null>(null)

  const uptime = startTime ? formatTimestamp(startTime) : t('Unknown')
  const version = currentVersion || t('Unknown')

  const handleCheckUpdates = async () => {
    setChecking(true)
    try {
      const response = await checkSystemUpdate()
      if (!response.success || !response.data) {
        throw new Error(response.message || t('Failed to check for updates'))
      }
      const data = response.data.release_info as ReleaseInfo | undefined
      if (!data?.tag_name) {
        throw new Error(t('Unexpected release payload'))
      }
      setUpdateInfo({
        repository: response.data.repository,
        image: response.data.image,
        has_update: response.data.has_update,
        can_auto_update: response.data.can_auto_update,
        auto_update_hint: response.data.auto_update_hint,
      })

      if (!response.data.has_update) {
        toast.success(
          t('You are running the latest version ({{version}}).', {
            version: data.tag_name,
          })
        )
        return
      }

      setRelease(data)
      setDialogOpen(true)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('Failed to check for updates')
      toast.error(message)
    } finally {
      setChecking(false)
    }
  }

  const handleApplyUpdate = async () => {
    setUpdating(true)
    try {
      const response = await applySystemUpdate()
      if (!response.success) {
        throw new Error(response.message || t('Auto update failed'))
      }
      toast.success(response.message || t('Auto update started'))
      setConfirmOpen(false)
      setDialogOpen(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('Auto update failed')
      toast.error(message)
    } finally {
      setUpdating(false)
    }
  }

  const goToRelease = () => {
    if (release?.html_url) {
      window.open(release.html_url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <>
      <SettingsSection
        title={t('System maintenance')}
        description={t('Review current version and fetch release notes.')}
      >
        <div className='space-y-6'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='rounded-lg border p-4'>
              <div className='text-muted-foreground text-sm'>
                {t('Current version')}
              </div>
              <div className='text-lg font-semibold'>{version}</div>
            </div>
            <div className='rounded-lg border p-4'>
              <div className='text-muted-foreground text-sm'>
                {t('Uptime since')}
              </div>
              <div className='text-lg font-semibold'>{uptime}</div>
            </div>
          </div>

          <Button onClick={handleCheckUpdates} disabled={checking}>
            {checking ? (
              t('Checking updates...')
            ) : (
              <>
                <RefreshCcwIcon className='me-2 h-4 w-4' />
                {t('Check for updates')}
              </>
            )}
          </Button>
        </div>
      </SettingsSection>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-h-[80vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>
              {release?.tag_name
                ? t('New version available: {{version}}', {
                    version: release.tag_name,
                  })
                : t('Release details')}
            </DialogTitle>
            {release?.published_at && (
              <DialogDescription>
                {t('Published')}{' '}
                {formatTimestampToDate(
                  new Date(release.published_at).getTime(),
                  'milliseconds'
                )}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className='space-y-4'>
            {updateInfo && (
              <Alert>
                <AlertDescription className='space-y-1 text-sm'>
                  <div>
                    {t('Update source')}: {updateInfo.repository}
                  </div>
                  <div>
                    {t('Target image')}: {updateInfo.image}
                  </div>
                  {!updateInfo.can_auto_update &&
                    updateInfo.auto_update_hint && (
                      <div className='text-destructive'>
                        {t('Auto update unavailable')}:{' '}
                        {updateInfo.auto_update_hint}
                      </div>
                    )}
                </AlertDescription>
              </Alert>
            )}
            {release?.body ? (
              <Markdown>{release.body}</Markdown>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('No release notes provided.')}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='secondary'
              onClick={() => setDialogOpen(false)}
            >
              {t('Close')}
            </Button>
            {release?.html_url && (
              <Button type='button' onClick={goToRelease}>
                <ExternalLinkIcon className='me-2 h-4 w-4' />
                {t('Open release')}
              </Button>
            )}
            {updateInfo?.has_update && (
              <Button
                type='button'
                onClick={() => setConfirmOpen(true)}
                disabled={!updateInfo.can_auto_update || updating}
              >
                <RocketIcon className='me-2 h-4 w-4' />
                {updating ? t('Updating...') : t('Auto update')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Confirm auto update')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'The server will pull the target image and recreate the app container. The page may disconnect briefly during restart.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updating}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleApplyUpdate} disabled={updating}>
              {updating ? t('Updating...') : t('Confirm update')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
