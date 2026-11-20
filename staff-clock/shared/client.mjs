export async function api(path, options = {}) {
  const { method = 'GET', body, signal } = options
  let response
  try {
    response = await fetch('/api' + path, {
      method, signal, credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Could not reach French Tacos Antwerp. Check your connection and try again.')
  }
  let payload
  try { payload = await response.json() } catch { throw new Error('The server is temporarily unavailable. Try again.') }
  if (!response.ok) {
    const error = new Error(payload.error ?? 'Something went wrong. Try again.')
    error.status = response.status
    throw error
  }
  return payload
}
