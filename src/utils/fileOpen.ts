export function pickPdfFile(multiple = false): Promise<File | File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf,.pdf'
    input.multiple = multiple
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (multiple) resolve(files.length ? files : null)
      else resolve(files[0] ?? null)
    }
    input.oncancel = () => resolve(null)
    input.click()
  })
}
