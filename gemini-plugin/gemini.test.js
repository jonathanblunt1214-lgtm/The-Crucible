import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRpc } from '../chatgpt-mcp/server.js';

test('Gemini tool surface exposes only the 3 canonical tools', async () => {
  const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.error, undefined);
  const toolNames = res.result.tools.map(t => t.name).sort();
  assert.deepEqual(toolNames, [
    'crucible_canonical_governance',
    'crucible_nexus_manifest',
    'crucible_plugin_info'
  ]);
});
