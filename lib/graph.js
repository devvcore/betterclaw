/**
 * MiniGraph — minimal pure-JS directed graph. Zero dependencies.
 * Nodes have { type, ...attrs }, edges have { type, ...attrs }.
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'like',
  'through', 'after', 'over', 'between', 'out', 'up', 'down', 'off',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'because', 'if', 'when', 'where', 'how', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am',
  'its', 'my', 'we', 'our', 'your', 'his', 'her', 'they', 'them',
  'it', 'he', 'she', 'you', 'me', 'him', 'us',
  'also', 'then', 'now', 'here', 'there', 'why', 'well', 'still',
  'even', 'back', 'much', 'many', 'way', 'get', 'got', 'let', 'say',
  'tell', 'know', 'think', 'see', 'want', 'use', 'try', 'ask',
  'need', 'feel', 'take', 'come', 'make', 'find', 'give', 'put',
  'thing', 'things', 'stuff', 'something', 'anything', 'everything',
  'nothing', 'someone', 'anyone', 'everyone', 'nobody', 'work',
  'works', 'working', 'worked', 'going', 'done', 'look', 'looks',
  'right', 'sure', 'okay', 'yeah', 'yes', 'hey', 'please', 'thanks',
]);

export class MiniGraph {
  constructor() {
    this._nodes = new Map();     // id → { type, ...attrs }
    this._outEdges = new Map();  // nodeId → [{ target, type, ...attrs }]
    this._inEdges = new Map();   // nodeId → [{ source, type, ...attrs }]
  }

  addNode(id, attrs = {}) {
    this._nodes.set(id, attrs);
    if (!this._outEdges.has(id)) this._outEdges.set(id, []);
    if (!this._inEdges.has(id)) this._inEdges.set(id, []);
  }

  mergeNode(id, attrs = {}) {
    const existing = this._nodes.get(id);
    if (existing) {
      this._nodes.set(id, { ...existing, ...attrs });
    } else {
      this.addNode(id, attrs);
    }
  }

  hasNode(id) {
    return this._nodes.has(id);
  }

  getNode(id) {
    return this._nodes.get(id) || null;
  }

  addEdge(source, target, attrs = {}) {
    // Ensure both nodes exist
    if (!this._nodes.has(source)) this.addNode(source, {});
    if (!this._nodes.has(target)) this.addNode(target, {});

    // Avoid duplicate edges of same type
    const out = this._outEdges.get(source);
    const exists = out.some(e => e.target === target && e.type === attrs.type);
    if (exists) return;

    out.push({ target, ...attrs });
    this._inEdges.get(target).push({ source, ...attrs });
  }

  neighbors(id) {
    const result = new Set();
    for (const e of this._outEdges.get(id) || []) result.add(e.target);
    for (const e of this._inEdges.get(id) || []) result.add(e.source);
    return [...result];
  }

  edges(id) {
    return [
      ...(this._outEdges.get(id) || []).map(e => ({ source: id, ...e })),
      ...(this._inEdges.get(id) || []).map(e => ({ target: id, ...e })),
    ];
  }

  search(query) {
    const terms = query.toLowerCase().split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t));
    if (terms.length === 0) return [];

    const results = [];

    for (const [id, attrs] of this._nodes) {
      const text = [id, attrs.summary, attrs.text, attrs.name]
        .filter(Boolean).join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (text.includes(t)) score += 1;
      }
      if (score > 0) results.push({ id, attrs, score });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  traverse(id, hops = 1) {
    const visited = new Set();
    const queue = [{ id, depth: 0 }];
    const result = [];

    while (queue.length > 0) {
      const { id: nodeId, depth } = queue.shift();
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const attrs = this._nodes.get(nodeId);
      if (attrs) result.push({ id: nodeId, attrs, depth });

      if (depth < hops) {
        for (const n of this.neighbors(nodeId)) {
          if (!visited.has(n)) queue.push({ id: n, depth: depth + 1 });
        }
      }
    }

    return result;
  }

  get nodeCount() {
    return this._nodes.size;
  }

  get edgeCount() {
    let count = 0;
    for (const edges of this._outEdges.values()) count += edges.length;
    return count;
  }

  export() {
    const nodes = [];
    for (const [id, attrs] of this._nodes) {
      nodes.push({ id, ...attrs });
    }

    const edges = [];
    for (const [source, outs] of this._outEdges) {
      for (const edge of outs) {
        edges.push({ source, ...edge });
      }
    }

    return { nodes, edges };
  }

  static import(json) {
    const g = new MiniGraph();
    for (const node of json.nodes || []) {
      const { id, ...attrs } = node;
      g.addNode(id, attrs);
    }
    for (const edge of json.edges || []) {
      const { source, target, ...attrs } = edge;
      g.addEdge(source, target, attrs);
    }
    return g;
  }
}
