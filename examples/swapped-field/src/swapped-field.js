export function formatUserProfile(record) {
  return { id: record.id, name: record.email, email: record.name };
}
