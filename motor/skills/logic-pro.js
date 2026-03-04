// OCA Motor Skill: Logic Pro
// Music production — play, record, navigate, mix
import motor from '../engine.js';

// Transport controls
export async function play() {
  await motor.activateApp('Logic Pro');
  await sleep(300);
  await motor.press('space');
}

export async function stop() {
  await motor.activateApp('Logic Pro');
  await sleep(300);
  await motor.press('space'); // space toggles play/stop
}

export async function record() {
  await motor.activateApp('Logic Pro');
  await sleep(300);
  await motor.press('r');
}

// Go to beginning
export async function goToStart() {
  await motor.press('return');
}

// Rewind/forward
export async function rewind() {
  await motor.press(',');
}

export async function forward() {
  await motor.press('.');
}

// Track management
export async function newTrack() {
  // Option+Cmd+N
  await motor.press('n', ['option', 'cmd']);
}

export async function muteTrack() {
  await motor.press('m');
}

export async function soloTrack() {
  await motor.press('s');
}

// Zoom
export async function zoomIn() {
  await motor.press('right', ['cmd']);
}

export async function zoomOut() {
  await motor.press('left', ['cmd']);
}

// Undo/Redo
export async function undo() {
  await motor.press('z', ['cmd']);
}

export async function redo() {
  await motor.press('z', ['cmd', 'shift']);
}

// Save
export async function save() {
  await motor.press('s', ['cmd']);
}

// Open mixer
export async function toggleMixer() {
  await motor.press('x');
}

// Open piano roll
export async function togglePianoRoll() {
  await motor.press('p');
}

// Bounce (export)
export async function bounce() {
  await motor.press('b', ['cmd']);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { 
  play, stop, record, goToStart, rewind, forward, 
  newTrack, muteTrack, soloTrack, 
  zoomIn, zoomOut, undo, redo, save, 
  toggleMixer, togglePianoRoll, bounce 
};
