// Connective words that stay lowercase in the middle of a Portuguese title.
const CONNECTIVES = new Set([
  "a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "na", "nas",
  "no", "nos", "para", "por", "com", "sem",
])

/**
 * Formats category names coming from Nuvemshop, which arrive in ALL CAPS
 * ("KITS PARA COZINHA"). Only reformats fully-uppercase names — names that
 * already have mixed case ("Produtos MAB") were curated by someone and are
 * left as-is.
 */
export function formatCategoryName(name: string): string {
  if (!name || name !== name.toLocaleUpperCase("pt-BR")) return name

  return name
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, idx) => {
      if (idx > 0 && CONNECTIVES.has(word)) return word
      return word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1)
    })
    .join(" ")
}
