export async function forbiddenOnlyFansCall() {
  return fetch('https://onlyfans.com/api2/v2/users/me')
}
