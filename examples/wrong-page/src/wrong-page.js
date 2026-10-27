export async function fetchPage(pageNumber, fetchImpl) {
  const page = pageNumber - 1;
  return fetchImpl(`https://api.example.invalid/items?page=${page}`);
}
