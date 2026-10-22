/**
 * Product `metadata.pending_changes` holds the seller's unreviewed edits. The
 * store fields guard rejects explicit requests for it, but Medusa's default
 * fields still pull whole products through relations (e.g. `*items.variant.product`
 * on `GET /store/orders/:id` and cart completion). Stripping the key from every
 * store response closes those paths and any future one.
 *
 * Copy-on-write instead of mutating in place: response objects can be shared
 * with a query cache or with code that still runs after the response (the
 * moderation flow reads `pending_changes`), so deleting the key from them would
 * corrupt server-side state. Containers are copied only along a path that
 * actually changed, so the common payload without pending edits allocates
 * nothing and is returned as is.
 */
export function stripPendingChanges<T>(payload: T): T {
  return strip(payload, new WeakSet(), new WeakMap()) as T
}

const PENDING_KEY = "pending_changes"

function strip(value: unknown, inProgress: WeakSet<object>, done: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value
  if (done.has(value)) return done.get(value)
  // A cycle back to an ancestor: keep the reference. A cyclic payload cannot be
  // serialized by res.json anyway, so this only has to terminate.
  if (inProgress.has(value)) return value
  inProgress.add(value)

  let result: unknown = value
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null
    value.forEach((item, i) => {
      const next = strip(item, inProgress, done)
      if (next !== item) (copy ??= value.slice())[i] = next
    })
    if (copy) result = copy
  } else {
    const source = value as Record<string, unknown>
    let copy: Record<string, unknown> | null = null
    const ensureCopy = () =>
      // Keep the prototype so class instances (e.g. with toJSON) serialize the same way.
      (copy ??= Object.assign(Object.create(Object.getPrototypeOf(source)), source))
    for (const key of Object.keys(source)) {
      const child = source[key]
      let next = strip(child, inProgress, done)
      if (key === "metadata" && next && typeof next === "object" && !Array.isArray(next) &&
          Object.prototype.hasOwnProperty.call(next, PENDING_KEY)) {
        const { [PENDING_KEY]: _removed, ...rest } = next as Record<string, unknown>
        next = rest
      }
      if (next !== child) ensureCopy()[key] = next
    }
    if (copy) result = copy
  }

  inProgress.delete(value)
  done.set(value, result)
  return result
}
