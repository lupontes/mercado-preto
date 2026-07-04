import sanitizeHtml from "sanitize-html"

export function sanitizeDescription(html: string | undefined): string {
  return sanitizeHtml(html ?? "", {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt"],
    },
  })
}
