/** A text value from FormData ('' when missing or when the entry is a file). */
export function formText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}
