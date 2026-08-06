/** Join class names, dropping anything falsy. The app's whole class-name story. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
