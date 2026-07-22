import { authOrigin, getSessionToken } from './auth'

export const MAX_COMMUNITY_IMAGE_BYTES = 5 * 1024 * 1024
export const COMMUNITY_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export function validateCommunityImage(file: File) {
  if (!(COMMUNITY_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'Paste a PNG, JPEG, WebP, or GIF image.'
  if (file.size > MAX_COMMUNITY_IMAGE_BYTES) return 'Images must be 5 MB or smaller.'
  return null
}

export async function uploadCommunityImage(file: File) {
  const validationError = validateCommunityImage(file)
  if (validationError) throw new Error(validationError)
  const headers = new Headers({ 'Content-Type': file.type })
  const token = getSessionToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(new URL('/api/uploads/images', authOrigin()), {
    method: 'POST',
    headers,
    body: file,
    mode: 'cors',
  })
  const result = await response.json().catch(() => ({})) as { url?: string; error?: string }
  if (!response.ok || !result.url) throw new Error(result.error || 'Could not upload the image. Try again.')
  return result.url
}
