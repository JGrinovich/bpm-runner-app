export async function poll(fn, { intervalMs = 2000, timeoutMs = 60000 } = {}) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result = await fn();
    if (result?.status === "done" || result?.status === "failed") return result;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for job");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
