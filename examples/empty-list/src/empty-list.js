export function extractItemNames(response) {
  return response.items.map((item) => item.name);
}
