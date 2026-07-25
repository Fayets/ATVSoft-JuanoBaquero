type Platform = 'calendly' | 'fathom' | 'manychat'

/** Las credenciales viven en FastAPI (`ApiConnection`). Esta capa quedó vacía tras migrar desde el mock local. */
export async function getCredentialsByToken(_platform: Platform, _webhookToken: string) {
  return null as { userId: string; credentials: Record<string, string> } | null
}

export async function getCredentialsByUser(_platform: Platform, _userId: string) {
  return null as Record<string, string> | null
}
