import { Modules } from "@medusajs/framework/utils"

/**
 * Tells subscribers (the store search index) that a seller's profile changed.
 * Best effort: the change is already saved, so a failed notification is
 * logged instead of failing the request.
 */
export async function notifySellerUpdated(scope: { resolve: (key: string) => any }, sellerId: string): Promise<void> {
  try {
    await scope.resolve(Modules.EVENT_BUS).emit({ name: "seller.updated", data: { id: sellerId } })
  } catch (err: unknown) {
    scope.resolve("logger")?.error?.(
      `[seller-events] falha ao avisar a atualização do vendedor ${sellerId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
