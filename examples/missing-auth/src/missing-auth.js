export async function sendAuthorizedRequest(url, token, fetchImpl) {
  return fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
}
