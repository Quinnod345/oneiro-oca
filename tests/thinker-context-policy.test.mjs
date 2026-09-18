import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterContextRowsForThinker,
  shouldIncludeTargetProject,
  targetProjectPromptSection,
  textPreview
} from '../thinker-context-policy.js';

const sillTarget = {
  name: 'sill',
  display_name: 'Sill',
  problem_statement: 'Fragment shelf',
  thesis: 'Build a menubar shelf',
  constraints: ['SwiftUI'],
  aesthetic_anchors: ['Things 3'],
  initial_brief: 'Build Sill'
};

test('parked target is not included in thinker prompt unless build is enabled', () => {
  assert.equal(shouldIncludeTargetProject({}), false);
  assert.equal(shouldIncludeTargetProject({ OCA_ENABLE_AUTONOMOUS_BUILD: '1' }), true);
  assert.equal(shouldIncludeTargetProject({ ONEIRO_THINKER_INCLUDE_TARGET_PROJECT: 'true' }), true);

  const section = targetProjectPromptSection(sillTarget, { includeTargetProject: false });
  assert.match(section, /PARKED BUILD TARGET/);
  assert.doesNotMatch(section, /Sill/);
});

test('project-scoped dreams are filtered when direct context is unrelated', () => {
  const rows = [
    { content: 'Sill replacement preview should use a warmer slot material.' },
    { content: 'Oneiro Mobile TestFlight build needs a truthful thoughts feed.' }
  ];

  const filtered = filterContextRowsForThinker(rows, {
    target: sillTarget,
    includeTargetProject: false,
    contextParts: ['Simulator', 'iPhone 16 Pro - Oneiro Mobile']
  });

  assert.deepEqual(filtered.map(row => row.content), [
    'Oneiro Mobile TestFlight build needs a truthful thoughts feed.'
  ]);
});

test('project-scoped dreams stay available when the current screen names the project', () => {
  const rows = [
    { content: 'Sill replacement preview should use a warmer slot material.' }
  ];

  const filtered = filterContextRowsForThinker(rows, {
    target: sillTarget,
    includeTargetProject: false,
    contextParts: ['Xcode', 'Sill ContentView.swift']
  });

  assert.equal(filtered.length, 1);
});

test('dream preview keeps prompt context bounded', () => {
  const preview = textPreview('First line about Oneiro.\n[+] Older appended note '.repeat(40), 80);
  assert.ok(preview.length <= 80);
  assert.match(preview, /…$/);
});
