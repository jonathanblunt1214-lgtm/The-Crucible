// Applied at every network "connection point" this codebase has (collisions.js,
// githubRepoSecurity.js, coreRefIntegrity.js): validates dynamic values before
// they are interpolated into a request URL, and validates the final URL is a
// well-formed HTTPS request before any fetch is issued. This closes the
// injection surface on values that come from outside this code (a caller's
// core_ref input, GITHUB_REPOSITORY) - it does not and cannot implement a
// network-perimeter firewall, since this code already runs inside the exact
// GitHub Actions environment such a perimeter would have to sit in front of.
// GITHUB_API_URL is intentionally not restricted to a fixed host: this
// codebase already supports GitHub Enterprise Server by reading that variable
// instead of hardcoding api.github.com, and a hardcoded allowlist would break
// that on every existing call site.

function assertWellFormedApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Refusing to call a malformed API URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`Refusing a non-HTTPS API call to "${parsed.hostname}".`);
  return parsed;
}

// GitHub owner names cannot end in a hyphen, but repository names may (for
// example, "Nexus-"). Keep the two segments separate so valid repositories
// are accepted without permitting extra path segments or URL syntax.
const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeRepository(repository) {
  if (typeof repository !== 'string' || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error(`Refusing to use an unsafe repository identifier where "owner/repo" was expected: ${JSON.stringify(repository)}`);
  }
  return repository;
}

// A full or abbreviated commit SHA - hex only, nothing else. Rejects
// anything that could be a path segment, a URL, or a shell/format-string
// trick riding along in what should be a plain hash.
const GIT_SHA_PATTERN = /^[0-9a-fA-F]{7,40}$/;

function assertSafeCommitSha(sha) {
  if (typeof sha !== 'string' || !GIT_SHA_PATTERN.test(sha)) {
    throw new Error(`Refusing to use a value that is not a plain commit SHA where one is required: ${JSON.stringify(sha)}`);
  }
  return sha;
}

module.exports = { assertWellFormedApiUrl, assertSafeRepository, assertSafeCommitSha };
