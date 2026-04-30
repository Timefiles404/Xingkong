import { createFileRoute } from '@tanstack/react-router'
import { AppHeader, Main } from '@/components/layout'
import { ImagePlayground } from '@/features/image-playground'

export const Route = createFileRoute('/_authenticated/playground/images')({
  component: ImagePlaygroundPage,
})

function ImagePlaygroundPage() {
  return (
    <>
      <AppHeader />
      <Main className='p-0'>
        <ImagePlayground />
      </Main>
    </>
  )
}
