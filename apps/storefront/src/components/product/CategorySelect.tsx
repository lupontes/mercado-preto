'use client'

import { useEffect, useState } from 'react'
import { listCategories, type Category } from '@/lib/api'

type CategorySelectProps = {
  value: string
  onChange: (categoryId: string) => void
}

export function CategorySelect({ value, onChange }: CategorySelectProps) {
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    listCategories()
      .then((data) => setCategories(data.product_categories))
      .catch(() => setCategories([]))
  }, [])

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input">
      <option value="">Sem categoria</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  )
}
