// WebCheck — api/_common/middleware.js
// Maintained by: krypthane | github.com/wavegxz-design
//
// FIX [BUG-MW-01]: Both module.exports AND export default → CJS/ESM conflict. Removed module.exports.
// FIX [BUG-MW-02]: netlifyHandler timeout returned 500 for all errors → 408 for timeouts.
// FIX [BUG-MW-03]: Two typos fixed: "temporatily"→"temporarily", "instand"→"instance".

const normalizeUrl = (url) => url.startsWith('http') ? url : `https://${url}`;

const TIMEOUT = process.env.API_TIMEOUT_LIMIT
  ? parseInt(process.env.API_TIMEOUT_LIMIT, 10)
  : 60000;

const ALLOWED_ORIGINS = process.env.API_CORS_ORIGIN || '*';
const DISABLE_EVERYTHING = !!process.env.VITE_DISABLE_EVERYTHING;

let PLATFORM = 'NETLIFY';
if (process.env.PLATFORM)      { PLATFORM = process.env.PLATFORM.toUpperCase(); }
else if (process.env.VERCEL)   { PLATFORM = 'VERCEL'; }
else if (process.env.WC_SERVER){ PLATFORM = 'NODE'; }

const headers = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
  'Access-Control-Allow-Credentials': true,
  'Content-Type': 'application/json;charset=UTF-8',
};

const timeoutErrorMsg =
  'Request timed-out. You can retry by clicking "Retry".\n'
  + 'If self-hosting, increase API_TIMEOUT_LIMIT in your environment variables.\n\n'
  + `Current timeout: ${TIMEOUT}ms`;

// FIX [BUG-MW-03]: fixed typos "temporatily" and "instand"
const disabledErrorMsg =
  'Error - WebCheck Temporarily Disabled.\n\n'
  + 'Due to increased running costs, the public instance has been temporarily disabled. '
  + 'You can run your own instance by following the instructions in the GitHub repo.';

const commonMiddleware = (handler) => {
  const createTimeoutPromise = (ms) =>
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed-out after ${ms} ms`)), ms)
    );

  // ── Vercel / Node ────────────────────────────────────────────────
  const vercelHandler = async (request, response) => {
    if (DISABLE_EVERYTHING) return response.status(503).json({ error: disabledErrorMsg });

    const rawUrl = (request.query || {}).url;
    if (!rawUrl) return response.status(400).json({ error: 'No URL specified' });

    const url = normalizeUrl(rawUrl);
    try {
      const result = await Promise.race([handler(url, request), createTimeoutPromise(TIMEOUT)]);
      if (result?.body && result?.statusCode) {
        response.status(result.statusCode).json(result.body);
      } else {
        response.status(200).json(typeof result === 'object' ? result : JSON.parse(result));
      }
    } catch (error) {
      const isTimeout = error.message.includes('timed-out');
      response.status(isTimeout ? 408 : 500).json({
        error: isTimeout ? `${error.message}\n\n${timeoutErrorMsg}` : error.message,
      });
    }
  };

  // ── Netlify ──────────────────────────────────────────────────────
  const netlifyHandler = async (event, context, callback) => {
    if (DISABLE_EVERYTHING) {
      return callback(null, { statusCode: 503, body: JSON.stringify({ error: disabledErrorMsg }), headers });
    }

    const rawUrl = (event.queryStringParameters || event.query || {}).url;
    if (!rawUrl) {
      // FIX [BUG-MW-02]: was 500 for missing param → 400
      return callback(null, { statusCode: 400, body: JSON.stringify({ error: 'No URL specified' }), headers });
    }

    const url = normalizeUrl(rawUrl);
    try {
      const result = await Promise.race([handler(url, event, context), createTimeoutPromise(TIMEOUT)]);
      if (result?.body && result?.statusCode) {
        callback(null, result);
      } else {
        callback(null, {
          statusCode: 200,
          body: typeof result === 'object' ? JSON.stringify(result) : result,
          headers,
        });
      }
    } catch (error) {
      // FIX [BUG-MW-02]: was always 500, now 408 for timeouts
      const isTimeout = error.message.includes('timed-out');
      callback(null, {
        statusCode: isTimeout ? 408 : 500,
        body: JSON.stringify({ error: isTimeout ? `${error.message}\n\n${timeoutErrorMsg}` : error.message }),
        headers,
      });
    }
  };

  return ['VERCEL', 'NODE'].includes(PLATFORM) ? vercelHandler : netlifyHandler;
};

// FIX [BUG-MW-01]: REMOVED module.exports — was causing CJS/ESM dual-export conflict
export default commonMiddleware;
