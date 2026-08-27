const fs = require('node:fs');
const path = require('node:path');

const FOLDER_ROLES = ['influences-main', 'checks-only', 'archive', 'independent'];
const IGNORED_FOLDERS = new Set(['.git', '.github', 'node_modules']);

function discoverProjectFolders(root) {
  return fs.readdirSync(root, { withFileTypes:true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED_FOLDERS.has(entry.name))
    .map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
}

function validateFolderTopology(value) {
  if (value === undefined) return null;
  if (!value || value.mode !== 'explicit' || !Array.isArray(value.folders) || value.folders.length < 3 || value.folders.length > 50) throw new Error('project.folderTopology must explicitly describe 3 through 50 folders.');
  const seen = new Set();
  const folders = value.folders.map((entry, index) => {
    if (!entry || typeof entry.path !== 'string' || !entry.path || path.isAbsolute(entry.path) || entry.path.includes('/') || entry.path.includes('\\') || entry.path === '..') throw new Error(`project.folderTopology.folders[${index}].path must be one top-level folder name.`);
    const key = entry.path.toLowerCase();
    if (seen.has(key)) throw new Error('project.folderTopology contains duplicate folders.');
    seen.add(key);
    if (!Array.isArray(entry.roles) || !entry.roles.length || entry.roles.some((role) => !FOLDER_ROLES.includes(role))) throw new Error(`project.folderTopology.folders[${index}].roles must use supported roles.`);
    const roles = [...new Set(entry.roles)];
    if (roles.includes('independent') && roles.length > 1) throw new Error('An independent folder cannot also influence Main, run checks, or be archival.');
    const links = entry.links || [];
    if (!Array.isArray(links) || links.some((link) => typeof link !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(link))) throw new Error(`project.folderTopology.folders[${index}].links must contain safe link identifiers.`);
    return { path:entry.path, roles, links:[...new Set(links.map((link) => link.toLowerCase()))] };
  });
  return { mode:'explicit', folders };
}

async function askFolderTopology(root, prompt, suppliedFolders) {
  const folders = suppliedFolders || discoverProjectFolders(root);
  if (folders.length < 3) return null;
  const configured = [];
  for (const folder of folders) {
    const answer = await prompt.question(`Folder "${folder}" roles (${FOLDER_ROLES.join(', ')}; comma-separated combinations allowed): `);
    const roles = answer.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    const linkAnswer = await prompt.question(`Folder "${folder}" link identifiers (optional, comma-separated; use suffix/slash links already established): `);
    const links = linkAnswer.split(',').map((item) => item.trim()).filter(Boolean);
    configured.push({ path:folder, roles, links });
  }
  return validateFolderTopology({ mode:'explicit', folders:configured });
}

module.exports = { FOLDER_ROLES, discoverProjectFolders, validateFolderTopology, askFolderTopology };
