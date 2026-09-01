const NATURAL_INDEX: Record<string, number> = { c: 0, d: 1, e: 2, f: 3, g: 4, a: 5, b: 6 }

const OCTAVE4: Record<string, number> = {
  c: 261.63,
  d: 293.66,
  e: 329.63,
  f: 349.23,
  g: 392.0,
  a: 440.0,
  b: 493.88,
}

// Turns a chord like "gbd" into ascending frequencies (G4, B4, D5) by bumping
// the octave each time the next natural note would otherwise be lower in pitch.
function chordFrequencies(letters: string): number[] {
  let octave = 0
  let prevIndex = -1
  const freqs: number[] = []
  for (const letter of letters) {
    const idx = NATURAL_INDEX[letter]
    if (prevIndex !== -1 && idx <= prevIndex) octave += 1
    freqs.push(OCTAVE4[letter] * 2 ** octave)
    prevIndex = idx
  }
  return freqs
}

// Chorus riff of "Jump" (Van Halen), transcribed as block chords.
const RIFF = ['gbd', 'gce', 'fac', 'fac', 'gbd', 'gbd', 'gce', 'fac', 'cfa', 'ceg', 'cdg']

// One key per distinct chord (repeats in the riff reuse the same key)...
const uniqueChords: string[] = []
// ...and the order in which those keys must be pressed to play the riff,
// as indices into uniqueChords — repeats mean pressing the same key again.
const sequence: number[] = []

for (const chord of RIFF) {
  let index = uniqueChords.indexOf(chord)
  if (index === -1) {
    index = uniqueChords.length
    uniqueChords.push(chord)
  }
  sequence.push(index)
}

export const JUMP_KEYS: number[][] = uniqueChords.map(chordFrequencies)
export const JUMP_SEQUENCE: number[] = sequence
export const JUMP_KEY_LABELS: string[] = uniqueChords.map((chord) =>
  chord.toUpperCase().split('').join('-'),
)
