import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const audioDir = path.join(repoRoot, 'video/public/audio');
const durationSeconds = 60;
const sampleRate = 44_100;

const voiceover = `Your team already writes Markdown.
Vaultmark turns it into a searchable knowledge portal, while docs stay where they belong, in S3.
Open the workspace and the vault is organized into spaces, with real counts, recent pages, and generated docs.
Ask Wiki lets you question that vault directly. It searches your docs, respects scope, and gives grounded answers with citations.
When new Markdown arrives, upload it. Raw files can move through AI assisted curation, while authored pages publish directly.
Search finds runbooks, specs, generated summaries, and personal notes without moving content out of Markdown.
And when an answer should become durable knowledge, save it back as a reviewed page.
Vaultmark: portable docs, searchable knowledge, and AI assisted work.`;

mkdirSync(audioDir, { recursive: true });
writeFileSync(path.join(audioDir, 'voiceover.txt'), `${voiceover}\n`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function midiToHz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function envelope(t, attack = 0.04, release = 0.22) {
  const a = Math.min(1, t / attack);
  const r = Math.min(1, (1 - t) / release);
  return Math.max(0, Math.min(a, r));
}

function tone(freq, t) {
  return Math.sin(2 * Math.PI * freq * t) + 0.22 * Math.sin(2 * Math.PI * freq * 2 * t);
}

function makeMusicBed() {
  const totalSamples = durationSeconds * sampleRate;
  const samples = new Int16Array(totalSamples);
  const chords = [
    [57, 60, 64, 69],
    [53, 57, 60, 65],
    [48, 52, 55, 60],
    [55, 59, 62, 67],
  ];

  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / sampleRate;
    const beat = t * 2;
    const bar = Math.floor(beat / 4);
    const chord = chords[bar % chords.length];
    const chordPos = (beat % 4) / 4;
    const arpIndex = Math.floor((beat * 2) % chord.length);
    const barEnv = envelope(chordPos, 0.08, 0.55);

    let sample = 0;

    for (const note of chord) {
      sample += tone(midiToHz(note), t) * 0.018 * barEnv;
    }

    sample += tone(midiToHz(chord[arpIndex] + 12), t) * 0.05 * envelope((beat * 2) % 1, 0.02, 0.16);
    sample += Math.sin(2 * Math.PI * midiToHz(chord[0] - 12) * t) * 0.052 * envelope((beat % 2) / 2, 0.03, 0.38);

    const kickPhase = beat % 1;
    if (kickPhase < 0.16) {
      sample += Math.sin(2 * Math.PI * (72 - kickPhase * 180) * t) * 0.09 * (1 - kickPhase / 0.16);
    }

    const fadeIn = Math.min(1, t / 3);
    const fadeOut = Math.min(1, (durationSeconds - t) / 4);
    sample *= fadeIn * fadeOut * 0.7;
    samples[i] = Math.max(-32767, Math.min(32767, Math.round(sample * 32767)));
  }

  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  writeFileSync(path.join(audioDir, 'music-bed.wav'), buffer);
}

makeMusicBed();

const aiffPath = path.join(audioDir, 'voiceover.aiff');
const wavPath = path.join(audioDir, 'voiceover.wav');
run('/usr/bin/say', ['-r', '174', '-o', aiffPath, voiceover]);
run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath]);
