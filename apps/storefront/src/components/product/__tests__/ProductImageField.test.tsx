// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The spy only records calls; the result comes from `upload.impl`. A vi.fn
// returning a rejected promise is reported by Vitest as an unhandled error.
const upload = vi.hoisted(() => ({ calls: vi.fn(), impl: (_file: File): Promise<string> => new Promise<string>(() => {}) }))
const uploadSellerImage = upload.calls
vi.mock('@/lib/seller-api', () => ({
  uploadSellerImage: (file: File) => {
    upload.calls(file)
    return upload.impl(file)
  },
}))

import ProductImageField from '../ProductImageField'

const file = (size: number, type: string, name = 'foto') => new File([new Uint8Array(size)], name, { type })

function setup(value = '') {
  const onChange = vi.fn()
  const onUploadingChange = vi.fn()
  render(<ProductImageField value={value} onChange={onChange} onUploadingChange={onUploadingChange} />)
  return { onChange, onUploadingChange, input: screen.getByLabelText('Escolher foto') as HTMLInputElement }
}

describe('ProductImageField', () => {
  beforeEach(() => {
    upload.calls.mockReset()
    upload.impl = () => new Promise<string>(() => {})
  })

  it('uploads a valid photo, reports progress and shows the new preview', async () => {
    let resolve!: (url: string) => void
    upload.impl = () => new Promise<string>((r) => { resolve = r })
    const { onChange, onUploadingChange, input } = setup()

    await userEvent.upload(input, file(1024, 'image/png'))
    expect(screen.getByText('Enviando foto...')).toBeInTheDocument()
    expect(onUploadingChange).toHaveBeenLastCalledWith(true)

    resolve('https://site/static/produto.png')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('https://site/static/produto.png'))
    expect(onUploadingChange).toHaveBeenLastCalledWith(false)
  })

  it('shows the given url as the preview', () => {
    setup('https://site/static/atual.jpg')
    expect(screen.getByAltText('Foto principal do produto')).toHaveAttribute('src', 'https://site/static/atual.jpg')
  })

  it('rejects a photo over 5 MB without calling the backend', async () => {
    const { input, onChange } = setup()
    await userEvent.upload(input, file(5 * 1024 * 1024 + 1, 'image/jpeg'))

    expect(screen.getByText('A foto passa de 5 MB. Escolha uma foto menor.')).toBeInTheDocument()
    expect(uploadSellerImage).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects an unsupported type without calling the backend', async () => {
    const { input } = setup()
    await userEvent.upload(input, file(100, 'image/gif'), { applyAccept: false })

    expect(screen.getByText('Envie uma foto em JPG, PNG ou WebP.')).toBeInTheDocument()
    expect(uploadSellerImage).not.toHaveBeenCalled()
  })

  it('keeps the current photo when the upload fails', async () => {
    upload.impl = async () => { throw new Error('Não foi possível enviar a foto. Tente novamente.') }
    const { input, onChange, onUploadingChange } = setup('https://site/static/atual.jpg')

    await userEvent.upload(input, file(1024, 'image/jpeg'))

    expect(await screen.findByText('Não foi possível enviar a foto. Tente novamente.')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(onUploadingChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByAltText('Foto principal do produto')).toHaveAttribute('src', 'https://site/static/atual.jpg')
  })

  it('lets the seller paste an image address instead', async () => {
    const { onChange } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'ou cole o endereço de uma imagem' }))
    await userEvent.type(screen.getByLabelText('Endereço da imagem'), 'h')

    expect(onChange).toHaveBeenLastCalledWith('h')
  })
})
