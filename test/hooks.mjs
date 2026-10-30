// Send the service's `@netlify/blobs` import to the in-memory stub.
export async function resolve(specifier, context, next) {
  if (specifier === "@netlify/blobs") return { url: new URL("./stub-blobs.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
