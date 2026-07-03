// Conectivos que ficam em minúsculas no meio de um título em português.
const CONNECTIVES = new Set([
  "a", "as", "o", "os", "e", "de", "da", "das", "do", "dos", "em", "na", "nas",
  "no", "nos", "para", "por", "com", "sem",
])

/**
 * Formata nomes de categoria vindos da Nuvemshop, que chegam em CAIXA ALTA
 * ("KITS PARA COZINHA"). Só reformata nomes inteiramente maiúsculos — nomes
 * já mistos ("Produtos MAB") foram curados por alguém e ficam como estão.
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
