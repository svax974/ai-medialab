/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import type { DiagramType, GraphData, GraphEdge, GraphNode, SequenceData } from '../types/diagramTypes';

/** A Mermaid node/participant id: letters, digits, underscore only (anything else can break the parser). */
function sanitizeId(id: string, seen: Set<string>): string {
  const base = id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1') || '_';
  let candidate = base;
  let i = 1;
  while (seen.has(candidate)) candidate = `${base}_${i++}`;
  seen.add(candidate);
  return candidate;
}

/** Mermaid reads `"` as the end of a quoted label: replace it, and collapse newlines (a label is one line). */
function sanitizeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
}

function remapIds(nodes: GraphNode[], edges: GraphEdge[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const seen = new Set<string>();
  const map = new Map<string, string>();
  const safeNodes = nodes.map((n) => {
    const safe = sanitizeId(n.id, seen);
    map.set(n.id, safe);
    return { ...n, id: safe };
  });
  const known = new Set(safeNodes.map((n) => n.id));
  const safeEdges = edges
    .map((e) => ({ ...e, from: map.get(e.from) ?? '', to: map.get(e.to) ?? '' }))
    .filter((e) => known.has(e.from) && known.has(e.to)); // drop an edge that refers to a node the model did not list
  return { nodes: safeNodes, edges: safeEdges };
}

const SHAPE_WRAP: Record<GraphNode['shape'], [string, string]> = {
  rect: ['[', ']'],
  round: ['(', ')'],
  diamond: ['{', '}'],
  circle: ['((', '))'],
  stadium: ['([', '])'],
};

function nodeLine(n: GraphNode): string {
  const [open, close] = SHAPE_WRAP[n.shape] ?? SHAPE_WRAP.rect;
  return `  ${n.id}${open}"${sanitizeLabel(n.label)}"${close}`;
}

function edgeLine(e: GraphEdge): string {
  const arrow = e.style === 'dashed' ? '-.->' : '-->';
  const label = e.label ? `|"${sanitizeLabel(e.label)}"|` : '';
  return `  ${e.from} ${arrow}${label} ${e.to}`;
}

/** `flowchart` / `orgchart` / `architecture`: the same renderer. `architecture` groups nodes into `subgraph` blocks
 * (`group`); `orgchart` forces a top-down direction (the usual shape for a hierarchy); plain `flowchart` keeps the
 * model's own choice of direction. */
function graphToFlowchart(data: GraphData, type: DiagramType): string {
  const { nodes, edges } = remapIds(data.nodes, data.edges);
  const direction = type === 'orgchart' ? 'TD' : data.direction === 'LR' ? 'LR' : 'TD';
  const lines = [`flowchart ${direction}`];
  if (type === 'architecture') {
    const groups = new Map<string, GraphNode[]>();
    const ungrouped: GraphNode[] = [];
    for (const n of nodes) {
      if (!n.group) {
        ungrouped.push(n);
        continue;
      }
      const members = groups.get(n.group) ?? [];
      members.push(n);
      groups.set(n.group, members);
    }
    let i = 0;
    for (const [group, members] of groups) {
      lines.push(`  subgraph sg${i++}["${sanitizeLabel(group)}"]`);
      for (const n of members) lines.push(`  ${nodeLine(n).trim()}`);
      lines.push('  end');
    }
    for (const n of ungrouped) lines.push(nodeLine(n));
  } else {
    for (const n of nodes) lines.push(nodeLine(n));
  }
  for (const e of edges) lines.push(edgeLine(e));
  return lines.join('\n');
}

/** `state`: Mermaid's state-transition syntax is structurally the same graph (states, transitions with a label);
 * a node id (case-insensitive) of "start" or "end" becomes Mermaid's `[*]` pseudo-state. */
function graphToState(data: GraphData): string {
  const { nodes, edges } = remapIds(data.nodes, data.edges);
  const nameOf = new Map(nodes.map((n) => [n.id, /^(start|end)$/i.test(n.label) ? '[*]' : n.id]));
  const lines = ['stateDiagram-v2'];
  for (const n of nodes) if (nameOf.get(n.id) === n.id) lines.push(`  ${n.id} : ${sanitizeLabel(n.label)}`);
  for (const e of edges) {
    const label = e.label ? ` : ${sanitizeLabel(e.label)}` : '';
    lines.push(`  ${nameOf.get(e.from)} --> ${nameOf.get(e.to)}${label}`);
  }
  return lines.join('\n');
}

/** `mindmap`: Mermaid's mindmap is an indented tree, not a general graph. Builds the first spanning tree reachable
 * from a root (a node with no incoming edge, else the first node); edges that would create a second parent or a
 * cycle are dropped rather than producing invalid Mermaid. A graph with no nodes at all is not representable. */
function graphToMindmap(data: GraphData): string {
  const { nodes, edges } = remapIds(data.nodes, data.edges);
  if (!nodes.length) return 'mindmap\n  root';
  const incoming = new Set(edges.map((e) => e.to));
  const root = nodes.find((n) => !incoming.has(n.id)) ?? nodes[0];
  const children = new Map<string, string[]>();
  for (const e of edges) children.set(e.from, [...(children.get(e.from) ?? []), e.to]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines = ['mindmap'];
  const visited = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (visited.has(id)) return; // already placed: a second parent would need a second copy, which mindmap can't express
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    lines.push(`${'  '.repeat(depth + 1)}${sanitizeLabel(node.label)}`);
    for (const child of children.get(id) ?? []) walk(child, depth + 1);
  };
  walk(root.id, 0);
  for (const n of nodes) if (!visited.has(n.id)) walk(n.id, 0); // orphans still get drawn, as extra top-level branches
  return lines.join('\n');
}

function sequenceToMermaid(data: SequenceData): string {
  const seen = new Set<string>();
  const map = new Map<string, string>();
  const participants = data.participants.map((p) => {
    const safe = sanitizeId(p.id, seen);
    map.set(p.id, safe);
    return { ...p, id: safe };
  });
  const known = new Set(participants.map((p) => p.id));
  const lines = ['sequenceDiagram'];
  for (const p of participants) lines.push(`  participant ${p.id} as ${sanitizeLabel(p.label)}`);
  for (const m of data.messages) {
    const from = map.get(m.from);
    const to = map.get(m.to);
    if (!from || !to || !known.has(from) || !known.has(to)) continue; // refers to a participant the model did not list
    const arrow = m.style === 'async' ? '-)' : m.style === 'reply' ? '-->>' : '->>';
    lines.push(`  ${from}${arrow}${to}: ${sanitizeLabel(m.label)}`);
  }
  return lines.join('\n');
}

/** `data` is the model's answer, already schema-valid (see `schemas.ts`): converts it to Mermaid source for
 * `diagramType`. Pure and total: no diagram type here can throw on well-formed input. */
export function toMermaid(diagramType: DiagramType, data: GraphData | SequenceData): string {
  if (diagramType === 'sequence') return sequenceToMermaid(data as SequenceData);
  const graph = data as GraphData;
  if (diagramType === 'state') return graphToState(graph);
  if (diagramType === 'mindmap') return graphToMindmap(graph);
  return graphToFlowchart(graph, diagramType);
}
