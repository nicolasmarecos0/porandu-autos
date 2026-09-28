/** Une clases condicionales. Sin merge de conflictos: evitar clases que compitan. */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}
