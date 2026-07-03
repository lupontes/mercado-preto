import sanitizeHtml from "sanitize-html"

// Descrições de produto podem conter HTML de autoria do seller (ex: catálogos
// migrados da Nuvemshop). O backend sanitiza na entrada, mas a defesa no ponto
// de exibição não pode depender disso — roda apenas em server components
// (sanitize-html usa htmlparser2, sem DOM, seguro no runtime Node do Next).
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ["src", "alt"],
  },
}

export function sanitizeDescriptionHtml(html: string | undefined): string {
  return sanitizeHtml(html ?? "", OPTIONS)
}

export function descriptionToPlainText(html: string | undefined): string {
  return sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
}
