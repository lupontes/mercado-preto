'use client'

import { useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { uploadSellerImage } from '@/lib/seller-api'

// Mirrors the backend limits so the seller gets instant feedback; the server
// still validates the bytes.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type Props = {
  value: string
  onChange: (url: string) => void
  onUploadingChange?: (uploading: boolean) => void
}

export default function ProductImageField({ value, onChange, onUploadingChange }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [showUrl, setShowUrl] = useState(false)

  function setBusy(busy: boolean) {
    setUploading(busy)
    onUploadingChange?.(busy)
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Envie uma foto em JPG, PNG ou WebP.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('A foto passa de 5 MB. Escolha uma foto menor.')
      return
    }
    setError('')
    setBusy(true)
    try {
      onChange(await uploadSellerImage(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar a foto. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {value ? (
          // A plain <img>: a pasted address may come from any host, which next/image would refuse.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Foto principal do produto" className="h-20 w-20 rounded-lg object-cover border border-onyx/10" />
        ) : (
          <div className="h-20 w-20 rounded-lg border border-dashed border-onyx/20 flex items-center justify-center text-onyx/30">
            <ImagePlus className="h-6 w-6" />
          </div>
        )}
        <label className={`inline-flex items-center gap-2 cursor-pointer rounded-lg border border-onyx/20 px-3 py-2 text-sm font-medium text-onyx hover:bg-onyx/5 ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          <span>{uploading ? 'Enviando foto...' : 'Escolher foto'}</span>
          <input
            type="file"
            aria-label="Escolher foto"
            accept={ACCEPTED_TYPES.join(',')}
            className="sr-only"
            disabled={uploading}
            onChange={(e) => {
              void handleFile(e.target.files?.[0])
              // Lets the seller pick the same file again after an error.
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {error && <p className="text-xs text-terracotta">{error}</p>}
      {showUrl ? (
        <input
          type="url"
          aria-label="Endereço da imagem"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input"
          placeholder="https://..."
        />
      ) : (
        <button type="button" className="text-xs text-onyx/50 underline" onClick={() => setShowUrl(true)}>
          ou cole o endereço de uma imagem
        </button>
      )}
      <p className="text-xs text-onyx/40">JPG, PNG ou WebP, até 5 MB.</p>
    </div>
  )
}
