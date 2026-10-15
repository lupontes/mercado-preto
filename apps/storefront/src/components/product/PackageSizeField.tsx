'use client'

import { useState } from 'react'
import { PACKAGE_SIZE_OPTIONS, exceedsCorreiosLimits, type PackageDimensions, type PackageSize } from '@/lib/package-size'

export type PackageValue = { size: PackageSize; dimensions?: PackageDimensions }

const FIELDS: Array<{ key: keyof PackageDimensions; label: string }> = [
  { key: 'length', label: 'Comprimento (cm)' },
  { key: 'width', label: 'Largura (cm)' },
  { key: 'height', label: 'Altura (cm)' },
  { key: 'weight', label: 'Peso (kg)' },
]

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'))
}

export default function PackageSizeField({ value, onChange }: { value: PackageValue; onChange: (v: PackageValue) => void }) {
  // Raw strings keep partial input like "1," while the seller is typing.
  const [raw, setRaw] = useState<Record<keyof PackageDimensions, string>>({
    length: value.dimensions?.length?.toString() ?? '',
    width: value.dimensions?.width?.toString() ?? '',
    height: value.dimensions?.height?.toString() ?? '',
    weight: value.dimensions?.weight?.toString().replace('.', ',') ?? '',
  })

  function setField(key: keyof PackageDimensions, text: string) {
    const next = { ...raw, [key]: text }
    setRaw(next)
    onChange({
      size: 'bulky',
      dimensions: { length: toNumber(next.length), width: toNumber(next.width), height: toNumber(next.height), weight: toNumber(next.weight) },
    })
  }

  const overLimit = value.size === 'bulky' && value.dimensions && exceedsCorreiosLimits(value.dimensions)

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-onyx">Tamanho da embalagem</legend>
      {PACKAGE_SIZE_OPTIONS.map((o) => (
        <label key={o.value} className="flex items-start gap-3 rounded-lg border border-sand-dark p-3 cursor-pointer">
          <input
            type="radio" name="packageSize" className="mt-1 accent-amber"
            checked={value.size === o.value}
            onChange={() => onChange(o.value === 'bulky' ? { size: 'bulky', dimensions: value.dimensions } : { size: o.value })}
            aria-label={o.label}
          />
          <span>
            <span className="font-semibold">{o.label}</span>
            <span className="block text-xs text-onyx/50">{o.hint}</span>
          </span>
        </label>
      ))}
      {value.size === 'bulky' && (
        <div className="grid grid-cols-2 gap-3 pt-2">
          <p className="col-span-2 text-xs text-onyx/60">
            Meça a caixa já fechada, com o produto dentro: comprimento, largura e altura com uma fita métrica, e pese numa balança de cozinha.
          </p>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`pkg-${f.key}`} className="text-xs font-semibold">{f.label}</label>
              <input id={`pkg-${f.key}`} inputMode="decimal" className="input" value={raw[f.key]} onChange={(e) => setField(f.key, e.target.value)} />
            </div>
          ))}
          {overLimit && (
            <p className="col-span-2 text-sm text-terracotta">
              Estas medidas estão acima do limite dos Correios (máx. 100 cm por lado, 200 cm somando os lados, 30 kg). Fale com a equipe do Mercado Preto.
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
