'use client'

import { useEffect, useState } from 'react'
import { listCategories, type Category } from '@/lib/api'

type CategorySelectProps = {
  value: string
  onChange: (categoryId: string, categoryName?: string) => void
  id?: string
}

export function CategorySelect({ value, onChange, id }: CategorySelectProps) {
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    listCategories()
      .then((data) => setCategories(data.product_categories))
      .catch((err) => {
        console.error('Failed to load categories', err)
        setCategories([])
      })
  }, [])

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value, categories.find((c) => c.id === e.target.value)?.name)} className="input">
      <option value="">Sem categoria</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </select>
  )
}
