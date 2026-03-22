// WebCheck — api/whois.js
// Maintained by: krypthane | github.com/wavegxz-design
//
// FIX [BUG-WHOIS-01]: whois-api-zeta.vercel.app was a hardcoded personal endpoint
//                     — SSRF/availability risk + no fallback if it goes down.
//                     Now uses fallback chain: internic → rdap.org (public IANA RDAP).
// FIX [BUG-WHOIS-02]: No timeout on axios.post → could hang indefinitely.
// FIX [BUG-WHOIS-03]: fetchFromInternic had no timeout on net.createConnection.

import net from 'net';
import psl from 'psl';
import axios from 'axios';
import middleware from './_common/middleware.js';

const NET_TIMEOUT_MS  = 8000;
const HTTP_TIMEOUT_MS = 10000;

const getBaseDomain = (url) => {
  let input = url;
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    input = 'http://' + input;
  }
  try {
    const hostname = new URL(input).hostname;
    const parsed   = psl.parse(hostname);
    return parsed.domain || hostname;
  } catch {
    return url;
  }
};

const parseWhoisData = (data) => {
  if (data.includes('No match for')) {
    return { error: 'No matches found for domain in internic database' };
  }
  const lines      = data.split('\r\n');
  const parsedData = {};
  let lastKey      = '';

  for (const line of lines) {
    const index = line.indexOf(':');
    if (index === -1) {
      if (lastKey) parsedData[lastKey] += ' ' + line.trim();
      continue;
    }
    let key   = line.slice(0, index).trim().replace(/\W+/g, '_');
    const val = line.slice(index + 1).trim();
    if (!val) continue;
    lastKey          = key;
    parsedData[key]  = val;
  }
  return parsedData;
};

/** Raw WHOIS via TCP port 43 to whois.internic.net */
const fetchFromInternic = (hostname) => {
  return new Promise((resolve, reject) => {
    // FIX [BUG-WHOIS-03]: Added connection timeout
    const client = net.createConnection({ port: 43, host: 'whois.internic.net' });
    const timer  = setTimeout(() => {
      client.destroy();
      reject(new Error('WHOIS TCP connection timed out'));
    }, NET_TIMEOUT_MS);

    client.once('connect', () => client.write(hostname + '\r\n'));

    let data = '';
    client.on('data',  (chunk) => { data += chunk; });
    client.on('end',   () => {
      clearTimeout(timer);
      try   { resolve(parseWhoisData(data)); }
      catch (e) { reject(e); }
    });
    client.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
};

/**
 * RDAP lookup via IANA's public RDAP service.
 * FIX [BUG-WHOIS-01]: replaces whois-api-zeta.vercel.app (personal/unreliable endpoint).
 */
const fetchFromRdap = async (domain) => {
  try {
    const resp = await axios.get(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      { timeout: HTTP_TIMEOUT_MS }
    );
    return resp.data;
  } catch (error) {
    return { error: `RDAP lookup failed: ${error.message}` };
  }
};

const whoisHandler = async (url) => {
  let hostname;
  try {
    hostname = getBaseDomain(url);
  } catch (error) {
    throw new Error(`Unable to parse URL: ${error.message}`);
  }

  // Run both in parallel — internic is authoritative, RDAP is structured
  const [internicResult, rdapResult] = await Promise.allSettled([
    fetchFromInternic(hostname),
    fetchFromRdap(hostname),
  ]);

  return {
    internicData: internicResult.status === 'fulfilled'
      ? internicResult.value
      : { error: internicResult.reason?.message },
    whoisData: rdapResult.status === 'fulfilled'
      ? rdapResult.value
      : { error: rdapResult.reason?.message },
  };
};

export const handler = middleware(whoisHandler);
export default handler;
