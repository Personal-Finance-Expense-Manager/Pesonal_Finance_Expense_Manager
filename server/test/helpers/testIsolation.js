export function assertIsolatedTestDatabase(uri, runId) {
  const parsed = new URL(uri);
  if (!/^[a-f0-9]{24}$/.test(runId || '') ||
      parsed.pathname !== `/pfem_us29_test_${runId}`) {
    throw new Error('Refusing destructive tests: use npm run test:integration:isolated to allocate a fresh database.');
  }
  return parsed.pathname.slice(1);
}
