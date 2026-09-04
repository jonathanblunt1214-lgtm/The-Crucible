'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const dns = require('node:dns').promises;
const https = require('node:https');
const { executableMagic, SUSPICIOUS_BINARY_EXTENSION } = require('./security');

const DEFAULT_CONTENT_TYPES = Object.freeze(['text/html', 'application/xhtml+xml', 'text/plain', 'application/pdf', 'application/json']);
const SOCIAL_MEDIA_DENYLIST = Object.freeze([
  'facebook.com', 'instagram.com', 'threads.net', 'twitter.com', 'x.com', 'tiktok.com', 'linkedin.com',
  'pinterest.com', 'snapchat.com', 'discord.com', 'discord.gg', 'telegram.org', 't.me', 'whatsapp.com',
  'youtube.com', 'youtu.be', 'twitch.tv', 'tumblr.com', 'medium.com', 'quora.com', 'mastodon.social',
  'bsky.app', 'weibo.com', 'vk.com', 'gab.com', 'truthsocial.com', 'parler.com', 'nextdoor.com'
]);
const NEWS_AGENCY_DOMAINS = Object.freeze([
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'cnn.com', 'foxnews.com', 'nbcnews.com', 'cbsnews.com',
  'abcnews.go.com', 'npr.org', 'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'bloomberg.com',
  'axios.com', 'politico.com', 'aljazeera.com', 'newsweek.com', 'time.com', 'usatoday.com'
]);
const ALWAYS_DENIED_DOMAINS = Object.freeze(['wikipedia.org', 'reddit.com', ...SOCIAL_MEDIA_DENYLIST]);
const INJECTION_PATTERNS = Object.freeze([
  /ignore\s+(all|any|the|previous|prior)\s+(instructions?|rules?|prompts?)/i,
  /system\s*prompt/i,
  /developer\s*message/i,
  /reveal|exfiltrat|upload.{0,30}(secret|credential|token|key)/i,
  /execute|run.{0,20}(command|shell|powershell|bash)/i,
]);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function normalizedHost(value) { return String(value || '').trim().toLowerCase().replace(/^\.+|\.+$/g, ''); }
function domainMatches(host, rule) { const target = normalizedHost(rule); return host === target || host.endsWith(`.${target}`); }
// An IPv4 address written as IPv6. ::ffff:169.254.169.254 is the cloud metadata endpoint and
// ::ffff:127.0.0.1 is loopback, but neither matches any IPv6 private prefix, so without this both
// were classified public and the network guard let them through. The address is normalised back to
// IPv4 and judged by the IPv4 rules, which is what it actually is.
function mappedIPv4(address) {
  const value = String(address).toLowerCase();
  const dotted = /^::(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/.exec(value);
  if (dotted && net.isIPv4(dotted[1])) return dotted[1];
  // The same address written as two hexadecimal groups rather than dotted quads.
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value);
  if (hex) {
    const high = parseInt(hex[1], 16), low = parseInt(hex[2], 16);
    return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
  }
  return null;
}
function privateAddress(address) {
  const mapped = net.isIPv6(address) ? mappedIPv4(address) : null;
  if (mapped) return privateAddress(mapped);
  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
      (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
  }
  return true;
}
function safeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('Only HTTPS retrieval is allowed.');
  if (url.username || url.password) throw new Error('URL credentials are forbidden.');
  if (url.port && url.port !== '443') throw new Error('Non-standard network ports are forbidden.');
  if (normalizedHost(url.hostname).endsWith('.onion') || normalizedHost(url.hostname) === 'onion') throw new Error('Onion services are forbidden.');
  url.hash = '';
  return url;
}
function metadataFromHtml(text) {
  function content(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const first = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']*)`, 'i').exec(text);
    const second = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escaped}["']`, 'i').exec(text);
    return (first || second)?.[1]?.trim() || null;
  }
  return { author:content('author') || 'not declared', license:content('license') || 'not declared; verify source terms before redistribution' };
}
function sanitizeHtml(text) {
  let previous;
  let current = String(text);
  do {
    previous = current;
    current = current
      .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\b[^>]*>/gi, '')
      .replace(/<form\b[^>]*>[\s\S]*?<\/form\b[^>]*>/gi, '')
      .replace(/<\/?(?:script|style|template|noscript|form)\b[^>]*>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:srcdoc|formaction)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  } while (current !== previous);
  return current;
}
function suspiciousText(buffer, contentType) {
  if (!/text|html|json|xml/i.test(contentType)) return [];
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 2 * 1024 * 1024));
  return INJECTION_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}
function parseGoogleSearchResults(html, { trustedDomains = [], trustedSuffixes = ['.edu', '.gov', '.org'], extremeVettingSuffixes = ['.science'], deniedDomains = [], newsDomains = NEWS_AGENCY_DOMAINS, maximumResults = 20 } = {}) {
  if (typeof html !== 'string') throw new Error('Google result HTML must be text.');
  if (!Array.isArray(trustedDomains) || !Array.isArray(trustedSuffixes) || !Array.isArray(extremeVettingSuffixes) || (!trustedDomains.length && !trustedSuffixes.length && !extremeVettingSuffixes.length)) throw new Error('A positive trusted-domain, trusted-suffix, or extreme-vetting-suffix allow-list is required.');
  if (!Number.isSafeInteger(maximumResults) || maximumResults < 1 || maximumResults > 100) throw new Error('maximumResults must be between 1 and 100.');
  const found = [];
  const seen = new Set();
  const hrefPattern = /href\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefPattern)) {
    let candidate = match[1].replace(/&amp;/g, '&');
    if (candidate.startsWith('/url?')) candidate = new URL(candidate, 'https://www.google.com').searchParams.get('q') || '';
    let url;
    try { url = safeUrl(candidate); } catch { continue; }
    const host = normalizedHost(url.hostname);
    if (domainMatches(host, 'google.com') || ALWAYS_DENIED_DOMAINS.some((rule) => domainMatches(host, rule)) || deniedDomains.some((rule) => domainMatches(host, rule))) continue;
    const extremeSuffix = extremeVettingSuffixes.some((suffix) => host.endsWith(String(suffix).toLowerCase()));
    const approved = extremeSuffix || trustedDomains.some((rule) => domainMatches(host, rule)) || trustedSuffixes.some((suffix) => host.endsWith(String(suffix).toLowerCase()));
    if (!approved) continue;
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const extremeVetting = extremeSuffix || newsDomains.some((rule) => domainMatches(host, rule));
    found.push({ url:normalized, host, approved:true, classification:'Insufficient Evidence', state:extremeVetting ? 'extreme-vetting-required' : 'trusted-domain-candidate-url', vetting:extremeVetting ? { primarySourceRequired:true, independentCorroborationRequired:true, contradictionAnalysisRequired:true, publicationReputationIsNotProof:true } : null });
    if (found.length >= maximumResults) break;
  }
  return found;
}

// Resolving once to check and then letting the HTTP client resolve again asks the same question
// twice, and can get two answers: between them a second DNS reply points the socket at a private
// address the guard never saw, and the guard is a formality. The connection is pinned to an address
// the guard already approved. The request still carries the real hostname, so Host, SNI and
// certificate validation are unchanged - only name resolution is fixed, which is the one part that
// was free to change its mind.
// A resolver that cannot ask anything. Whatever hostname it is handed, the only answers it can give
// are the addresses the guard already approved, so the second resolution has nothing left to decide.
function pinnedLookup(addresses) {
  const approved = addresses.map((item) => ({ address: String(item.address), family: Number(item.family) || (net.isIPv6(String(item.address)) ? 6 : 4) }));
  if (!approved.length) throw new Error('A pinned lookup needs at least one validated address.');
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const settings = typeof options === 'function' ? {} : (options || {});
    const wanted = settings.family ? Number(settings.family) : 0;
    const entries = approved.filter((item) => !wanted || item.family === wanted);
    if (!entries.length) { done(new Error('No validated address matches the requested address family.')); return; }
    if (settings.all) { done(null, entries.map((item) => ({ ...item }))); return; }
    done(null, entries[0].address, entries[0].family);
  };
}
function pinnedHttpsRequest(addresses) {
  const lookup = pinnedLookup(addresses);
  return (url, init = {}) => new Promise((resolve, reject) => {
    let target;
    try { target = safeUrl(String(url)); } catch (error) { reject(error); return; }
    const request = https.request(target, { method: init.method || 'GET', headers: init.headers || {}, lookup }, (message) => {
      resolve({
        status: message.statusCode,
        ok: message.statusCode >= 200 && message.statusCode < 300,
        url: target.toString(),
        headers: { get: (name) => { const value = message.headers[String(name).toLowerCase()]; if (value === undefined) return null; return Array.isArray(value) ? value.join(', ') : String(value); } },
        body: message,
      });
    });
    request.on('error', reject);
    const abort = () => request.destroy(new Error('Retrieval was aborted before it completed.'));
    if (init.signal) { if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true }); }
    request.end();
  });
}

class RetrievalAuditStore {
  constructor(root) { this.root = path.resolve(root); fs.mkdirSync(this.root, { recursive:true }); this.file = path.join(this.root, 'retrieval-audit.json'); }
  read() { if (!fs.existsSync(this.file)) return { schemaVersion:1, records:[] }; return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  append(record) {
    const value = this.read(); value.records.push(structuredClone(record));
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag:'wx', mode:0o600 }); fs.renameSync(temporary, this.file);
  }
}

class SafeInformationRetriever {
  constructor({ approvedUrls, approvedRedirectDomains = [], deniedDomains = [], auditStore, killSwitchFile, fetchImpl = null, lookup = dns.lookup, now = () => new Date().toISOString(), maximumBytes = 20 * 1024 * 1024, maximumRedirects = 5, timeoutMs = 20_000, minimumIntervalMs = 1_000, allowedContentTypes = DEFAULT_CONTENT_TYPES }) {
    if (!Array.isArray(approvedUrls) || !approvedUrls.length) throw new Error('At least one owner-approved URL is required.');
    if (!auditStore?.append) throw new Error('An auditable retrieval store is required.');
    this.approvedUrls = new Set(approvedUrls.map((item) => safeUrl(item).toString()));
    this.approvedRedirectDomains = approvedRedirectDomains.map(normalizedHost); this.deniedDomains = [...ALWAYS_DENIED_DOMAINS, ...deniedDomains.map(normalizedHost)];
    this.auditStore = auditStore; this.killSwitchFile = path.resolve(killSwitchFile); this.fetchImpl = fetchImpl; this.lookup = lookup; this.now = now;
    this.maximumBytes = maximumBytes; this.maximumRedirects = maximumRedirects; this.timeoutMs = timeoutMs; this.minimumIntervalMs = minimumIntervalMs; this.allowedContentTypes = [...allowedContentTypes]; this.lastRequestAt = 0;
  }
  async validateNetworkTarget(url) {
    const host = normalizedHost(url.hostname);
    if (this.deniedDomains.some((rule) => domainMatches(host, rule))) throw new Error('Target domain is denied.');
    const results = await this.lookup(host, { all:true, verbatim:true });
    if (!Array.isArray(results) || !results.length || results.some((item) => privateAddress(item.address))) throw new Error('Private, local, or unresolved network targets are forbidden.');
    // Returned so the connection can be pinned to exactly what was approved here.
    return results;
  }
  async retrieve(input) {
    const requested = safeUrl(input).toString(); const decisionAt = this.now();
    if (fs.existsSync(this.killSwitchFile)) {
      this.auditStore.append({ schemaVersion:1, requestedUrl:requested, decisionAt, state:'blocked', classification:'Insufficient Evidence', reason:'Retrieval kill switch is active.' });
      throw new Error('Retrieval kill switch is active.');
    }
    if (!this.approvedUrls.has(requested)) {
      this.auditStore.append({ schemaVersion:1, requestedUrl:requested, decisionAt, state:'blocked', classification:'Insufficient Evidence', reason:'URL is not owner supplied or explicitly approved.' });
      throw new Error('URL is not owner supplied or explicitly approved.');
    }
    let current = new URL(requested); let redirects = 0; let response;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      while (true) {
        const validated = await this.validateNetworkTarget(current);
        const delay = Math.max(0, this.minimumIntervalMs - (Date.now() - this.lastRequestAt));
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        this.lastRequestAt = Date.now();
        const send = this.fetchImpl || pinnedHttpsRequest(validated);
        response = await send(current, { method:'GET', redirect:'manual', credentials:'omit', referrerPolicy:'no-referrer', signal:controller.signal, headers:{ accept:this.allowedContentTypes.join(', '), 'user-agent':'The-Crucible-Evidence-Retriever/1.0' } });
        if (response.status < 300 || response.status >= 400) break;
        if (++redirects > this.maximumRedirects) throw new Error('Redirect limit exceeded.');
        const location = response.headers.get('location'); if (!location) throw new Error('Redirect has no location.');
        const next = safeUrl(new URL(location, current).toString());
        const sameHost = normalizedHost(next.hostname) === normalizedHost(new URL(requested).hostname);
        if (!sameHost && !this.approvedRedirectDomains.some((rule) => domainMatches(normalizedHost(next.hostname), rule))) throw new Error('Redirect target is not explicitly approved.');
        current = next;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}.`);
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!this.allowedContentTypes.includes(contentType)) throw new Error(`Content type ${contentType || 'missing'} is not allowed.`);
      const declared = Number(response.headers.get('content-length') || 0); if (declared > this.maximumBytes) throw new Error('Declared content length exceeds the configured limit.');
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > this.maximumBytes) throw new Error('Response exceeds the configured size limit.'); chunks.push(Buffer.from(chunk)); }
      const content = Buffer.concat(chunks); const magic = executableMagic(content);
      if (magic || SUSPICIOUS_BINARY_EXTENSION.test(new URL(response.url || current).pathname)) throw new Error(`Executable content quarantined: ${magic || 'suspicious extension'}.`);
      const injectionSignals = suspiciousText(content, contentType); const metadata = /html|xhtml/.test(contentType) ? metadataFromHtml(content.toString('utf8')) : { author:'not declared', license:'not declared; verify source terms before redistribution' };
      const record = { schemaVersion:1, requestedUrl:requested, finalUrl:safeUrl(response.url || current.toString()).toString(), retrievedAt:this.now(), author:metadata.author, license:metadata.license, contentType, contentLength:length, contentSha256:sha256(content), redirects, classification:injectionSignals.length ? 'Crucible Issue' : 'Insufficient Evidence', state:injectionSignals.length ? 'quarantined' : 'retrieved-candidate-evidence', quarantineReasons:injectionSignals.map(() => 'prompt-injection-pattern') };
      const parserContent = /html|xhtml/.test(contentType) ? Buffer.from(sanitizeHtml(content.toString('utf8'))) : content;
      this.auditStore.append(record); return { record, content:injectionSignals.length ? null : parserContent };
    } catch (error) {
      this.auditStore.append({ schemaVersion:1, requestedUrl:requested, decisionAt, state:'blocked', classification:'Insufficient Evidence', reason:String(error.message || error) }); throw error;
    } finally { clearTimeout(timer); }
  }
}

module.exports = { DEFAULT_CONTENT_TYPES, pinnedLookup, pinnedHttpsRequest, INJECTION_PATTERNS, SOCIAL_MEDIA_DENYLIST, NEWS_AGENCY_DOMAINS, privateAddress, safeUrl, sanitizeHtml, parseGoogleSearchResults, RetrievalAuditStore, SafeInformationRetriever };
