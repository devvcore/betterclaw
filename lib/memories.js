/**
 * Memory system — powered by the knowledge graph.
 * remember() stores knowledge as graph nodes.
 * recall() searches the graph.
 * listMemories() lists all memory nodes.
 */
import { loadGraph, saveGraphLocked } from './graph-memory.js';

function slugify(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Store a memory as a graph node.
 * @param {string} topic - Memory topic (becomes the node ID)
 * @param {string} content - Memory content
 * @returns {string} Confirmation message
 */
export async function remember(topic, content) {
  const id = `memory:${slugify(topic)}`;

  await saveGraphLocked(async (graph) => {
    graph.mergeNode(id, {
      type: 'memory',
      name: topic,
      text: content,
      timestamp: new Date().toISOString(),
    });
  });

  return `Remembered "${topic}" → graph node ${id}`;
}

/**
 * Recall a memory by topic — searches the graph.
 * @param {string} topic - Memory topic to recall
 * @returns {string} Memory content or not-found message
 */
export async function recall(topic) {
  const graph = await loadGraph();

  // Direct lookup first
  const directId = `memory:${slugify(topic)}`;
  const direct = graph.getNode(directId);
  if (direct) {
    const results = [`[Memory: ${direct.name}]\n${direct.text}`];

    // Also show connected nodes (1 hop)
    const neighbors = graph.traverse(directId, 1);
    for (const n of neighbors) {
      if (n.id === directId) continue;
      const a = n.attrs;
      if (a.type === 'memory') results.push(`Related memory: ${a.name} — ${(a.text || '').slice(0, 100)}`);
      else if (a.type === 'entity') results.push(`Related: ${a.name} (${a.entityType})`);
      else if (a.type === 'decision') results.push(`Decision: ${a.text}`);
      else if (a.type === 'preference') results.push(`Preference: ${a.text}`);
    }
    return results.join('\n');
  }

  // Fuzzy search
  const matches = graph.search(topic);
  if (matches.length === 0) return `No memory found for "${topic}".`;

  const sections = [];
  for (const match of matches.slice(0, 5)) {
    const a = match.attrs;
    if (a.type === 'memory') sections.push(`[Memory: ${a.name}]\n${a.text}`);
    else if (a.type === 'session') sections.push(`Session: ${(a.summary || '').slice(0, 200)}`);
    else if (a.type === 'entity') sections.push(`${a.entityType || 'topic'}: ${a.name} (${a.mentions} mentions)`);
    else if (a.type === 'person') sections.push(`Person: ${a.name} (${a.mentions} mentions)`);
    else if (a.type === 'decision') sections.push(`Decision: ${a.text}`);
    else if (a.type === 'frustration') sections.push(`Pitfall: ${a.text}`);
    else if (a.type === 'preference') sections.push(`Preference: ${a.text}`);
  }

  return sections.length > 0
    ? `[Graph search for "${topic}"]\n${sections.join('\n\n')}`
    : `No memory found for "${topic}".`;
}

/**
 * List all explicit memories stored in the graph.
 * @returns {string} Formatted list of memories
 */
export async function listMemories() {
  const graph = await loadGraph();
  const memories = [];

  for (const [id, attrs] of graph._nodes) {
    if (attrs.type === 'memory') {
      const preview = (attrs.text || '').split('\n').find(l => l.trim()) || '';
      memories.push(`${attrs.name} — ${preview.slice(0, 80)}`);
    }
  }

  if (memories.length === 0) return 'No memories stored yet. Use remember(topic, content) to store knowledge.';
  return memories.sort().join('\n');
}
