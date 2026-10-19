/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import type { GraphData, SequenceData } from '../types/diagramTypes';
import { toMermaid } from './toMermaid';

describe('toMermaid', () => {
  it('renders a flowchart with shapes, a labelled edge and a dashed edge', () => {
    const data: GraphData = {
      direction: 'LR',
      nodes: [
        { id: 'a', label: 'Start', shape: 'stadium' },
        { id: 'b', label: 'Decision?', shape: 'diamond' },
        { id: 'c', label: 'End', shape: 'round' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c', label: 'yes' },
        { from: 'b', to: 'a', style: 'dashed', label: 'no' },
      ],
    };
    expect(toMermaid('flowchart', data)).toBe(
      'flowchart LR\n' +
        '  a(["Start"])\n' +
        '  b{"Decision?"}\n' +
        '  c("End")\n' +
        '  a --> b\n' +
        '  b -->|"yes"| c\n' +
        '  b -.->|"no"| a',
    );
  });

  it('forces a top-down direction for an org chart regardless of what the model asked', () => {
    const data: GraphData = { direction: 'LR', nodes: [{ id: 'a', label: 'CEO', shape: 'rect' }], edges: [] };
    expect(toMermaid('orgchart', data)).toBe('flowchart TD\n  a["CEO"]');
  });

  it('groups nodes into subgraphs for an architecture diagram', () => {
    const data: GraphData = {
      nodes: [
        { id: 'a', label: 'API', shape: 'rect', group: 'Back' },
        { id: 'b', label: 'DB', shape: 'rect', group: 'Back' },
        { id: 'c', label: 'UI', shape: 'rect' },
      ],
      edges: [{ from: 'c', to: 'a' }],
    };
    expect(toMermaid('architecture', data)).toBe(
      'flowchart TD\n' + '  subgraph sg0["Back"]\n' + '  a["API"]\n' + '  b["DB"]\n' + '  end\n' + '  c["UI"]\n' + '  c --> a',
    );
  });

  it('renders a state diagram, mapping "start"/"end" labels to the [*] pseudo-state', () => {
    const data: GraphData = {
      nodes: [
        { id: 'a', label: 'Start', shape: 'rect' },
        { id: 'b', label: 'Running', shape: 'rect' },
        { id: 'c', label: 'End', shape: 'rect' },
      ],
      edges: [
        { from: 'a', to: 'b', label: 'launch' },
        { from: 'b', to: 'c' },
      ],
    };
    expect(toMermaid('state', data)).toBe('stateDiagram-v2\n  b : Running\n  [*] --> b : launch\n  b --> [*]');
  });

  it('renders a mindmap as an indented tree rooted at the node with no incoming edge', () => {
    const data: GraphData = {
      nodes: [
        { id: 'root', label: 'Project', shape: 'rect' },
        { id: 'a', label: 'Design', shape: 'rect' },
        { id: 'b', label: 'Build', shape: 'rect' },
        { id: 'c', label: 'Mockups', shape: 'rect' },
      ],
      edges: [
        { from: 'root', to: 'a' },
        { from: 'root', to: 'b' },
        { from: 'a', to: 'c' },
      ],
    };
    expect(toMermaid('mindmap', data)).toBe('mindmap\n  Project\n    Design\n      Mockups\n    Build');
  });

  it('drops an edge that refers to an unlisted node instead of producing invalid Mermaid', () => {
    const data: GraphData = { nodes: [{ id: 'a', label: 'A', shape: 'rect' }], edges: [{ from: 'a', to: 'ghost' }] };
    expect(toMermaid('flowchart', data)).toBe('flowchart TD\n  a["A"]');
  });

  it('sanitizes ids (spaces, accents) and de-duplicates collisions', () => {
    const data: GraphData = {
      nodes: [
        { id: 'étape 1', label: 'A', shape: 'rect' },
        { id: 'étape_1', label: 'B', shape: 'rect' },
      ],
      edges: [{ from: 'étape 1', to: 'étape_1' }],
    };
    expect(toMermaid('flowchart', data)).toBe('flowchart TD\n  _tape_1["A"]\n  _tape_1_1["B"]\n  _tape_1 --> _tape_1_1');
  });

  it('escapes a double quote in a label', () => {
    const data: GraphData = { nodes: [{ id: 'a', label: 'Say "hi"', shape: 'rect' }], edges: [] };
    expect(toMermaid('flowchart', data)).toBe('flowchart TD\n  a["Say \'hi\'"]');
  });

  it('renders a sequence diagram with sync, async and reply arrows', () => {
    const data: SequenceData = {
      participants: [
        { id: 'u', label: 'User' },
        { id: 's', label: 'Server' },
      ],
      messages: [
        { from: 'u', to: 's', label: 'request', style: 'sync' },
        { from: 's', to: 'u', label: 'ack', style: 'async' },
        { from: 's', to: 'u', label: 'response', style: 'reply' },
      ],
    };
    expect(toMermaid('sequence', data)).toBe(
      'sequenceDiagram\n' +
        '  participant u as User\n' +
        '  participant s as Server\n' +
        '  u->>s: request\n' +
        '  s-)u: ack\n' +
        '  s-->>u: response',
    );
  });

  it('drops a sequence message referring to an unlisted participant', () => {
    const data: SequenceData = { participants: [{ id: 'u', label: 'User' }], messages: [{ from: 'u', to: 'ghost', label: 'x' }] };
    expect(toMermaid('sequence', data)).toBe('sequenceDiagram\n  participant u as User');
  });
});
