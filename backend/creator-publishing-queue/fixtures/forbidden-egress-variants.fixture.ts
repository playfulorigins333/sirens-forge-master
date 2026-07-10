declare const axios: { get: (url: string) => Promise<void>; post: (url: string, body: unknown) => Promise<void> }
declare const got: (url: string) => Promise<void>
declare const request: (url: string) => Promise<void>
declare const https: { request: (url: string) => void }

export async function forbiddenFetchVariants() {
  await fetch(
    "https://fansly.com/api/v1/me"
  )
  await globalThis.fetch(new URL('https://onlyfans.com/api2/v2/users/me'))
  await window.fetch(`https://onlyfans.com/api2/v2/posts`)
}

export async function forbiddenClientVariants() {
  const fanslyUrl = 'https://apiv3.fansly.com/api/v1/account'
  await axios.get(fanslyUrl)
  await axios.post('https://apifansly.com/api/private', {})
  await got('https://fansly-api.com/private')
  await request('https://fansly.com/api/internal')
  https.request('https://onlyfans.com/api2/v2/users/me')
}

export async function forbiddenBrowserNavigation(page: { goto: (url: string) => Promise<void> }) {
  const url = 'https://onlyfans.com/api2/v2/users/me'
  await page.goto(url)
}
