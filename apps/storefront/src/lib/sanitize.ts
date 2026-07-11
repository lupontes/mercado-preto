import sanitizeHtml from "sanitize-html"

// Product descriptions may contain seller-authored HTML (e.g. catalogs
// migrated from Nuvemshop). The backend sanitizes on input, but defense at
// the display point shouldn't depend on that — this only runs in server
// components (sanitize-html uses htmlparser2, no DOM, safe in Next's Node
// runtime).
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["src", "alt"],
  },
}

/**
 * Nominal type for HTML that has already passed through sanitizeDescriptionHtml.
 * A component rendering via dangerouslySetInnerHTML should require this type
 * (not a plain string) for its HTML prop, so passing raw, unsanitized product
 * data in is a compile error instead of a silent XSS hole.
 */
export type SanitizedHtml = string & { readonly __brand: "SanitizedHtml" }

export function sanitizeDescriptionHtml(html: string | undefined): SanitizedHtml {
  return sanitizeHtml(html ?? "", OPTIONS) as SanitizedHtml
}

export function descriptionToPlainText(html: string | undefined): string {
  return sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
}
