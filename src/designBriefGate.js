const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DESIGN_BRIEF_FILENAME = 'THE-CRUCIBLE-DESIGN-BRIEF.md';

// Installing the design brief (templates/connect-workflow.yml, README
// "Install in another repository" step 10) is optional, so a project that
// never ran it must never be flagged here. Only an actual deletion - the
// file was committed at some point in this branch's history and is now
// absent - counts as severing the link.
function wasEverCommitted(root, filename) {
  try {
    const log = execFileSync('git', ['log', '--diff-filter=D', '--pretty=format:%H', '--', filename], { cwd: root, encoding: 'utf8', windowsHide: true });
    return log.trim().length > 0;
  } catch {
    return false;
  }
}

function auditDesignBrief(root) {
  const target = path.resolve(root, DESIGN_BRIEF_FILENAME);
  if (fs.existsSync(target)) return { severed: false };
  return { severed: wasEverCommitted(root, DESIGN_BRIEF_FILENAME) };
}

function formatSeveredNotice(repository) {
  return [
    '################################################################',
    '# THE CRUCIBLE LINK IS SEVERED',
    '################################################################',
    '',
    `${DESIGN_BRIEF_FILENAME} was installed in ${repository || 'this repository'} and has since been deleted.`,
    'That file is this repository\'s standing record of the operating rules it agreed to',
    'when it connected to The Crucible. Deleting it is treated as withdrawing from the',
    'connection, not as routine cleanup - so every Crucible check fails, on every branch,',
    'until it is restored.',
    '',
    'To restore the link: re-run templates/connect-workflow.yml from The Crucible\'s',
    'repository (see "Install in another repository", step 10, in its README) to',
    `recommit ${DESIGN_BRIEF_FILENAME}.`,
    '',
    'To end the connection instead: remove the caller workflow',
    '(.github/workflows/the-crucible.yml) and .thecrucible.json. A severed link with the',
    'caller workflow still in place is a broken configuration, not a valid one.',
  ].join('\n');
}

function publishSeveredNotice(notice, environment = process.env) {
  if (!environment.GITHUB_STEP_SUMMARY) return false;
  fs.appendFileSync(environment.GITHUB_STEP_SUMMARY, `## The Crucible link severed\n\n\`\`\`text\n${notice}\n\`\`\`\n\n`, 'utf8');
  return true;
}

module.exports = { DESIGN_BRIEF_FILENAME, wasEverCommitted, auditDesignBrief, formatSeveredNotice, publishSeveredNotice };
