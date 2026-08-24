const crypto = require('node:crypto');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter((key) => key !== '$schema' && key !== 'digest' && key !== 'integrity').sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function configurationDigest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function verifyConfigurationDigest(value) {
  if (!value.integrity?.digest) return { skipped:true, digest:configurationDigest(value) };
  const actual = configurationDigest(value);
  if (value.integrity.digest !== `sha256:${actual}`) throw new Error('Configuration digest does not match the reviewed settings.');
  return { skipped:false, digest:actual };
}

module.exports = { canonical, configurationDigest, verifyConfigurationDigest };
