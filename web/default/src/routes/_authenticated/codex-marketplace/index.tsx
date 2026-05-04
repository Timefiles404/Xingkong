import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { CodexMarketplace } from '@/features/codex-marketplace'

export const Route = createFileRoute('/_authenticated/codex-marketplace/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user) {
      throw redirect({ to: '/sign-in' })
    }
  },
  component: CodexMarketplace,
})
