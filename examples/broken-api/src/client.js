const baseURL = 'https://example.invalid/v0';

export async function fetchCurrentUser(fetchImpl) {
  const response = await fetchImpl(`${baseURL}/users/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `request failed (${response.status})`);
  }
  const body = await response.json();
  return { id: body.id, name: body.name };
}
