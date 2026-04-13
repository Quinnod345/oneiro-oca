#!/usr/bin/env node
/**
 * Train the JS MLP (Phase 1) on collected training data.
 * Reads from data/manifest.json and trains the model.
 *
 * Usage:
 *   node train-js.js            # Train on all data
 *   node train-js.js --epochs 5 # Multiple passes
 */

import { readFileSync, existsSync } from 'fs';
import { loadModel } from './model.js';
import { encodeFromCode } from './encoder.js';
import { SCORE_NAMES } from './knowledge.js';

const DATA_DIR = new URL('./data/', import.meta.url).pathname;
const MANIFEST_PATH = DATA_DIR + 'manifest.json';

function loadTrainingData() {
  if (!existsSync(MANIFEST_PATH)) {
    console.log('No training data found. Run: node collect-data.js generate 20');
    return [];
  }

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  const samples = [];

  for (const sample of manifest.samples || []) {
    // Need scores
    if (!sample.scores || typeof sample.scores !== 'object') continue;

    // Use pre-computed code features if available, otherwise encode from code file
    let features;
    if (sample.code_features && sample.code_features.length === 64) {
      features = new Float32Array(sample.code_features);
    } else if (sample.metadata?.code_path && existsSync(sample.metadata.code_path)) {
      const code = readFileSync(sample.metadata.code_path, 'utf-8');
      features = encodeFromCode(code, {
        platform: 'mac',
        targetEmotion: sample.metadata?.quality_target === 'high' ? 0.8 : 0.5,
      });
    } else {
      continue; // No features available
    }

    // Build target vector
    const target = new Float32Array(SCORE_NAMES.length);
    for (let i = 0; i < SCORE_NAMES.length; i++) {
      target[i] = Math.max(0, Math.min(1, sample.scores[SCORE_NAMES[i]] ?? 0.5));
    }

    samples.push({ features, target, source: sample.source, quality: sample.metadata?.quality_target });
  }

  return samples;
}

function train(epochs = 3) {
  const samples = loadTrainingData();
  if (samples.length === 0) return;

  console.log(`\nTraining JS MLP on ${samples.length} samples (${epochs} epochs)\n`);

  const model = loadModel();
  const statusBefore = model.getStatus();
  console.log(`Model: ${statusBefore.architecture} (${statusBefore.paramCount} params)`);
  console.log(`Running loss before: ${statusBefore.runningLoss.toFixed(4)}\n`);

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle
    const shuffled = [...samples].sort(() => Math.random() - 0.5);

    let epochLoss = 0;
    let epochSteps = 0;

    for (const sample of shuffled) {
      // Forward
      model.predict(sample.features, true); // training=true
      // Backward
      const result = model.learn(sample.target);
      epochLoss += result.loss;
      epochSteps++;
    }

    const avgLoss = epochLoss / epochSteps;
    console.log(`  epoch ${epoch + 1}/${epochs} | loss: ${avgLoss.toFixed(4)} | running: ${model.runningLoss.toFixed(4)}`);
  }

  // Save
  const savedPath = model.save();
  console.log(`\nWeights saved to: ${savedPath}`);

  // Final status
  const statusAfter = model.getStatus();
  console.log(`\nFinal running loss: ${statusAfter.runningLoss.toFixed(4)}`);
  console.log(`Total updates: ${statusAfter.totalUpdates}`);
  console.log(`Expansions: ${statusAfter.expansions}`);
  console.log(`At capacity: ${statusAfter.atCapacity}`);

  console.log(`\nPer-dimension error:`);
  for (const [dim, err] of Object.entries(statusAfter.perDimError)) {
    const bar = '█'.repeat(Math.round(err * 50));
    console.log(`  ${dim.padEnd(25)} ${err.toFixed(3)} ${bar}`);
  }

  // Test prediction on a sample
  console.log(`\nSample prediction vs target:`);
  const testSample = samples[0];
  const prediction = model.predict(testSample.features);
  for (let i = 0; i < SCORE_NAMES.length; i++) {
    const pred = prediction[i].toFixed(3);
    const target = testSample.target[i].toFixed(3);
    const diff = Math.abs(prediction[i] - testSample.target[i]);
    const marker = diff < 0.1 ? '✅' : diff < 0.2 ? '🟡' : '❌';
    console.log(`  ${SCORE_NAMES[i].padEnd(25)} pred=${pred} target=${target} ${marker}`);
  }
}

// CLI
const epochs = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--epochs') || '3');
train(epochs);
