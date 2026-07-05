type ProductCategoryLister = {
  listProductCategories(filters: { id: string[] }): Promise<unknown[]>
}

export async function categoryExists(
  productService: ProductCategoryLister,
  categoryId: string
): Promise<boolean> {
  const categories = await productService.listProductCategories({ id: [categoryId] })
  return categories.length > 0
}
