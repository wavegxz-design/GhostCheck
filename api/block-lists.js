// WebCheck — api/block-lists.js
// Maintained by: krypthane | github.com/wavegxz-design
//
// FIX [BUG-BL-01]: Node.js built-in dns.resolve4() does NOT support the
//                  { server } option — it silently ignored all custom DNS servers
//                  and always queried the system resolver.
//                  Fixed by using dns.promises.Resolver which properly supports
//                  setServers() for per-query custom DNS.

import { promises as dnsPromises } from 'dns';
import { URL } from 'url';
import middleware from './_common/middleware.js';

const DNS_SERVERS = [
  { name: 'AdGuard',              ip: '176.103.130.130' },
  { name: 'AdGuard Family',       ip: '176.103.130.132' },
  { name: 'CleanBrowsing Adult',  ip: '185.228.168.10'  },
  { name: 'CleanBrowsing Family', ip: '185.228.168.168' },
  { name: 'CleanBrowsing Security',ip:'185.228.168.9'   },
  { name: 'Cloudflare',           ip: '1.1.1.1'         },
  { name: 'Cloudflare Family',    ip: '1.1.1.3'         },
  { name: 'Comodo Secure',        ip: '8.26.56.26'      },
  { name: 'Google DNS',           ip: '8.8.8.8'         },
  { name: 'Neustar Family',       ip: '156.154.70.3'    },
  { name: 'Neustar Protection',   ip: '156.154.70.2'    },
  { name: 'Norton Family',        ip: '199.85.126.20'   },
  { name: 'OpenDNS',              ip: '208.67.222.222'  },
  { name: 'OpenDNS Family',       ip: '208.67.222.123'  },
  { name: 'Quad9',                ip: '9.9.9.9'         },
  { name: 'Yandex Family',        ip: '77.88.8.7'       },
  { name: 'Yandex Safe',          ip: '77.88.8.88'      },
];

// Known block/sink-hole IP addresses returned when a domain is blocked
const KNOWN_BLOCK_IPS = new Set([
  '146.112.61.106', '185.228.168.10', '8.26.56.26', '9.9.9.9',
  '208.69.38.170',  '208.69.39.170',  '208.67.222.222', '208.67.222.123',
  '199.85.126.10',  '199.85.126.20',  '156.154.70.22',
  '77.88.8.7',      '77.88.8.8',      '::1',
  '2a02:6b8::feed:0ff', '2a02:6b8::feed:bad', '2a02:6b8::feed:a11',
  '2620:119:35::35',    '2620:119:53::53',
  '2606:4700:4700::1111','2606:4700:4700::1001',
  '2001:4860:4860::8888','2a0d:2a00:1::','2a0d:2a00:2::',
]);

/**
 * FIX [BUG-BL-01]: Use dns.promises.Resolver with setServers() instead of
 * dns.resolve4(domain, { server }) which is a non-existent option in Node.js.
 * The Resolver class properly binds to a specific upstream nameserver.
 */
const isDomainBlocked = async (domain, serverIp) => {
  const resolver = new dnsPromises.Resolver();
  resolver.setServers([serverIp]);

  // Try IPv4 first
  try {
    const addrs = await resolver.resolve4(domain);
    if (addrs.some(a => KNOWN_BLOCK_IPS.has(a))) return true;
    return false;
  } catch (err4) {
    // ENOTFOUND / SERVFAIL from a filtering resolver = blocked
    if (err4.code === 'ENOTFOUND' || err4.code === 'SERVFAIL') return true;

    // Try IPv6 as fallback
    try {
      const addrs6 = await resolver.resolve6(domain);
      if (addrs6.some(a => KNOWN_BLOCK_IPS.has(a))) return true;
      return false;
    } catch (err6) {
      return err6.code === 'ENOTFOUND' || err6.code === 'SERVFAIL';
    }
  }
};

const blockListHandler = async (url) => {
  let domain;
  try {
    domain = new URL(url).hostname;
  } catch {
    throw new Error('Invalid URL provided');
  }

  // Run all DNS checks concurrently for speed
  const results = await Promise.all(
    DNS_SERVERS.map(async ({ name, ip }) => ({
      server:    name,
      serverIp:  ip,
      isBlocked: await isDomainBlocked(domain, ip).catch(() => false),
    }))
  );

  return { blocklists: results };
};

export const handler = middleware(blockListHandler);
export default handler;
