// WebCheck — api/tls.js
// Maintained by: krypthane | github.com/wavegxz-design
//
// FIX [BUG-TLS-01]: Mozilla TLS Observatory was DECOMMISSIONED in 2019.
//                   Endpoint returned 404/errors for 5+ years.
//                   Replaced with direct tls.connect() inspection + SSLLabs API fallback.
// FIX [BUG-TLS-02]: No timeout on axios POST/GET → hang on slow responses.

import tls from 'tls';
import axios from 'axios';
import middleware from './_common/middleware.js';

const TIMEOUT_MS = 10000;

/**
 * Get TLS details directly via Node tls.connect().
 * Returns cipher, protocol, certificate expiry, and SANs.
 */
const getTlsDirectInfo = (hostname, port = 443) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('TLS connection timed out'));
    }, TIMEOUT_MS);

    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false },
      () => {
        clearTimeout(timer);
        try {
          const cipher  = socket.getCipher();
          const cert    = socket.getPeerCertificate();
          const proto   = socket.getProtocol();
          socket.end();
          resolve({
            protocol:    proto,
            cipher:      cipher?.name  || null,
            bits:        cipher?.bits  || null,
            validFrom:   cert?.valid_from  || null,
            validTo:     cert?.valid_to    || null,
            subject:     cert?.subject     || null,
            issuer:      cert?.issuer      || null,
            subjectAltNames: cert?.subjectaltname || null,
            authorized:  socket.authorized,
          });
        } catch (e) {
          socket.end();
          reject(e);
        }
      }
    );

    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
};

/**
 * Try SSLLabs API for a deeper analysis (non-blocking, best-effort).
 * SSLLabs scans can take minutes; we only check for a cached result here.
 */
const getSslLabsCachedResult = async (hostname) => {
  try {
    const resp = await axios.get(
      `https://api.ssllabs.com/api/v3/analyze?host=${hostname}&fromCache=on&maxAge=24`,
      { timeout: 8000 }
    );
    if (resp.data?.status === 'READY') {
      const endpoint = resp.data.endpoints?.[0];
      return {
        grade:       endpoint?.grade        || null,
        hasWarnings: endpoint?.hasWarnings  || false,
        isExceptional: endpoint?.isExceptional || false,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const tlsHandler = async (url) => {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error('Invalid URL provided to TLS handler');
  }

  // Run both checks in parallel; SSLLabs is best-effort
  const [directInfo, labsInfo] = await Promise.allSettled([
    getTlsDirectInfo(hostname),
    getSslLabsCachedResult(hostname),
  ]);

  if (directInfo.status === 'rejected') {
    throw new Error(`TLS inspection failed: ${directInfo.reason?.message}`);
  }

  return {
    hostname,
    tls: directInfo.value,
    sslLabsGrade: labsInfo.status === 'fulfilled' ? labsInfo.value : null,
  };
};

export const handler = middleware(tlsHandler);
export default handler;
