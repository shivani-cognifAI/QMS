/**
 * runMiddleware — wraps an Express-style middleware so it can be awaited
 * in Next.js API routes. Required for multer file uploads.
 *
 * Usage:
 *   export const config = { api: { bodyParser: false } };
 *   await runMiddleware(req, res, upload.single('file'));
 */
function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

module.exports = { runMiddleware };
