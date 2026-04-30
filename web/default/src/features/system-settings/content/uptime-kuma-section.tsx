import { useEffect, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Edit, Save, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

type UptimeKumaGroup = {
  id: number
  categoryName: string
  url: string
  slug: string
}

type UptimeKumaSectionProps = {
  enabled: boolean
  data: string
}

const createUptimeKumaSchema = (t: (key: string) => string) =>
  z.object({
    categoryName: z
      .string()
      .min(1, { error: t('Category name is required') })
      .max(50, { error: t('Category name must be less than 50 characters') }),
    url: z.string().url({ error: t('Must be a valid URL') }),
    slug: z
      .string()
      .min(1, { error: t('Slug is required') })
      .max(100, { error: t('Slug must be less than 100 characters') })
      .regex(/^[a-zA-Z0-9_-]+$/, {
        error: t(
          'Slug can only contain letters, numbers, hyphens, and underscores'
        ),
      }),
  })

type UptimeKumaFormValues = z.infer<ReturnType<typeof createUptimeKumaSchema>>

export function UptimeKumaSection({ enabled, data }: UptimeKumaSectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const uptimeKumaSchema = createUptimeKumaSchema(t)
  const [groups, setGroups] = useState<UptimeKumaGroup[]>([])
  const [isEnabled, setIsEnabled] = useState(enabled)
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [showDialog, setShowDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [editingGroup, setEditingGroup] = useState<UptimeKumaGroup | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<'single' | 'batch'>('single')

  const form = useForm<UptimeKumaFormValues>({
    resolver: zodResolver(uptimeKumaSchema),
    defaultValues: {
      categoryName: 'New API',
      url: '',
      slug: '',
    },
  })

  useEffect(() => {
    try {
      const parsed = JSON.parse(data || '[]')
      if (Array.isArray(parsed)) {
        setGroups(
          parsed.map((item, idx) => ({
            ...item,
            id: item.id || idx + 1,
          }))
        )
      }
    } catch {
      setGroups([])
    }
  }, [data])

  useEffect(() => {
    setIsEnabled(enabled)
  }, [enabled])

  const handleToggleEnabled = async (checked: boolean) => {
    try {
      await updateOption.mutateAsync({
        key: 'console_setting.uptime_kuma_enabled',
        value: checked,
      })
      setIsEnabled(checked)
      toast.success(t('Setting saved'))
    } catch {
      toast.error(t('Failed to update setting'))
    }
  }

  const handleAdd = () => {
    setEditingGroup(null)
    form.reset({
      categoryName: 'New API',
      url: '',
      slug: '',
    })
    setShowDialog(true)
  }

  const handleEdit = (group: UptimeKumaGroup) => {
    setEditingGroup(group)
    form.reset({
      categoryName: group.categoryName,
      url: group.url,
      slug: group.slug,
    })
    setShowDialog(true)
  }

  const handleDelete = (group: UptimeKumaGroup) => {
    setEditingGroup(group)
    setDeleteTarget('single')
    setShowDeleteDialog(true)
  }

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) {
      toast.error(t('Please select items to delete'))
      return
    }
    setDeleteTarget('batch')
    setShowDeleteDialog(true)
  }

  const confirmDelete = () => {
    if (deleteTarget === 'single' && editingGroup) {
      setGroups((prev) => prev.filter((item) => item.id !== editingGroup.id))
      setHasChanges(true)
      toast.success(t('Group deleted. Click "Save Settings" to apply.'))
    } else if (deleteTarget === 'batch') {
      setGroups((prev) => prev.filter((item) => !selectedIds.includes(item.id)))
      setSelectedIds([])
      setHasChanges(true)
      toast.success(
        t('{{count}} groups deleted. Click "Save Settings" to apply.', {
          count: selectedIds.length,
        })
      )
    }
    setShowDeleteDialog(false)
    setEditingGroup(null)
  }

  const handleSubmitForm = (values: UptimeKumaFormValues) => {
    if (editingGroup) {
      setGroups((prev) =>
        prev.map((item) =>
          item.id === editingGroup.id ? { ...item, ...values } : item
        )
      )
      toast.success(t('Group updated. Click "Save Settings" to apply.'))
    } else {
      const newId = Math.max(...groups.map((item) => item.id), 0) + 1
      setGroups((prev) => [...prev, { id: newId, ...values }])
      toast.success(t('Group added. Click "Save Settings" to apply.'))
    }
    setHasChanges(true)
    setShowDialog(false)
  }

  const handleSaveAll = async () => {
    try {
      await updateOption.mutateAsync({
        key: 'console_setting.uptime_kuma_groups',
        value: JSON.stringify(groups),
      })
      setHasChanges(false)
      toast.success(t('Uptime Kuma groups saved successfully'))
    } catch {
      toast.error(t('Failed to save Uptime Kuma groups'))
    }
  }

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? groups.map((item) => item.id) : [])
  }

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) =>
      checked ? [...prev, id] : prev.filter((item) => item !== id)
    )
  }

  return (
    <SettingsSection
      title={t('Status Monitoring')}
      description={t(
        'Expose your public service status page directly on the overview dashboard'
      )}
    >
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center justify-between gap-2 rounded-xl border p-4'>
          <div className='space-y-1'>
            <div className='text-sm font-medium'>
              {t('Enable status monitoring')}
            </div>
            <div className='text-muted-foreground text-sm'>
              {t(
                'When enabled, the overview page will display the public service health panel.'
              )}
            </div>
          </div>
          <Switch checked={isEnabled} onCheckedChange={handleToggleEnabled} />
        </div>

        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              onClick={handleBatchDelete}
              size='sm'
              variant='destructive'
              disabled={selectedIds.length === 0}
            >
              <Trash2 className='mr-2 h-4 w-4' />
              {t('Delete (')}
              {selectedIds.length})
            </Button>
            <Button onClick={handleAdd} size='sm' variant='outline'>
              {groups.length > 0
                ? t('Add another status page')
                : t('Add status page')}
            </Button>
            <Button
              onClick={handleSaveAll}
              size='sm'
              variant='secondary'
              disabled={!hasChanges || updateOption.isPending}
            >
              <Save className='mr-2 h-4 w-4' />
              {updateOption.isPending ? t('Saving...') : t('Save Settings')}
            </Button>
          </div>
        </div>

        <Collapsible className='rounded-xl border' defaultOpen={groups.length === 0}>
          <CollapsibleTrigger asChild>
            <button
              type='button'
              className='flex w-full items-center justify-between px-4 py-3 text-left'
            >
              <div>
                <div className='text-sm font-medium'>
                  {t('Configuration help')}
                </div>
                <div className='text-muted-foreground mt-1 text-sm'>
                  {t('Point this to a public Uptime Kuma status page that already exists.')}
                </div>
              </div>
              <ChevronDown className='text-muted-foreground size-4 transition-transform data-[state=open]:rotate-180' />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className='text-muted-foreground border-t px-4 py-4 text-sm'>
            {t(
              'Example: url = http://uptime-kuma:3001, slug = newapi. The slug must match the status page slug configured in Uptime Kuma.'
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-12'>
                  <Checkbox
                    checked={
                      selectedIds.length === groups.length && groups.length > 0
                    }
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>{t('Category Name')}</TableHead>
                <TableHead>{t('Uptime Kuma URL')}</TableHead>
                <TableHead>{t('Status Page Slug')}</TableHead>
                <TableHead className='w-32'>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className='h-24 text-center'>
                    {t(
                      'No status pages yet. Click "Add status page" to create one.'
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.includes(group.id)}
                        onCheckedChange={(checked) =>
                          toggleSelectOne(group.id, checked as boolean)
                        }
                      />
                    </TableCell>
                    <TableCell className='font-medium'>
                      {group.categoryName}
                    </TableCell>
                    <TableCell
                      className='text-primary max-w-xs truncate font-mono text-sm'
                      title={group.url}
                    >
                      {group.url}
                    </TableCell>
                    <TableCell className='text-muted-foreground font-mono text-sm'>
                      {group.slug}
                    </TableCell>
                    <TableCell>
                      <div className='flex gap-2'>
                        <Button
                          onClick={() => handleEdit(group)}
                          size='sm'
                          variant='ghost'
                        >
                          <Edit className='h-4 w-4' />
                        </Button>
                        <Button
                          onClick={() => handleDelete(group)}
                          size='sm'
                          variant='ghost'
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingGroup
                ? t('Edit status page')
                : t('Add status page')}
            </DialogTitle>
            <DialogDescription>
              {t('Configure the public status page source shown on the overview dashboard')}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleSubmitForm)}
              className='space-y-4'
            >
              <FormField
                control={form.control}
                name='categoryName'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Category Name')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('e.g., New API')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Display name shown in the overview panel')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='url'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Uptime Kuma URL')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('http://uptime-kuma:3001')}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('Base URL of your Uptime Kuma instance')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='slug'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Status Page Slug')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('newapi')} {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('Status page slug configured in Uptime Kuma')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => setShowDialog(false)}
                >
                  {t('Cancel')}
                </Button>
                <Button type='submit'>
                  {editingGroup ? t('Update') : t('Add')}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Are you sure?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget === 'single'
                ? 'This status page will be removed from the list.'
                : `${selectedIds.length} status pages will be removed from the list.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
