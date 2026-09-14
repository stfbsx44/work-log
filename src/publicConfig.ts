export function isPublicKey(value: string | undefined) {
  if (!value || value.startsWith('sb_secret_')) return false
  if (value.startsWith('sb_publishable_')) return true
  try {
    const raw = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(raw)).role === 'anon'
  } catch { return false }
}
export function isProjectUrl(value: string | undefined) {
  return !!value && /^https:\/\/[^\s/]+\/?$/.test(value)
}
