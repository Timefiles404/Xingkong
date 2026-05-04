import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { CodexAccounts } from '@/features/codex-accounts'

export const Route = createFileRoute('/_authenticated/codex-accounts/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user) {
      throw redirect({ to: '/sign-in' })
    }
  },
  component: CodexAccounts,
})
