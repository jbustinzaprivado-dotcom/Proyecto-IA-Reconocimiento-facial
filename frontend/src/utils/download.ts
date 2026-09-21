// Hands a file the browser already has (a Blob) over to the person, as a download
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // The download has already started by now: the address can be released
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
