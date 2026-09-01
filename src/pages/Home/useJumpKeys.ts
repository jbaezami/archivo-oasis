import { useCallback, useEffect, useRef, useState } from 'react'
import { JUMP_KEYS, JUMP_SEQUENCE } from './jumpRiff'

function playChord(ctx: AudioContext, freqs: number[]) {
  const now = ctx.currentTime
  for (const freq of freqs) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.1, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.9)
  }
}

export type KeyFlash = { index: number; correct: boolean } | null

interface UseJumpKeysOptions {
  // Whether pressing a key should still count toward solving the riff.
  // Once the riff is already solved (or the visitor is authenticated), keys
  // stay playable for fun but stop tracking progress.
  trackProgress: boolean
  onComplete: () => void
}

// Chord playback + riff-progress tracking, shared between the 3D keys and the
// 1-6 keyboard shortcuts — kept outside <JumpKeys> so number presses keep
// working even after the visual keys are unmounted.
export function useJumpKeys({ trackProgress, onComplete }: UseJumpKeysOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const progressRef = useRef(0)
  const [flash, setFlash] = useState<KeyFlash>(null)
  const flashTimeoutRef = useRef<number | null>(null)

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  const handleKeyPress = useCallback(
    (index: number) => {
      playChord(getAudioContext(), JUMP_KEYS[index])

      if (!trackProgress) return

      const isCorrect = index === JUMP_SEQUENCE[progressRef.current]
      setFlash({ index, correct: isCorrect })
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current)
      flashTimeoutRef.current = window.setTimeout(() => setFlash(null), 220)

      if (isCorrect) {
        const next = progressRef.current + 1
        if (next === JUMP_SEQUENCE.length) {
          progressRef.current = 0
          onComplete()
        } else {
          progressRef.current = next
        }
      } else {
        progressRef.current = index === JUMP_SEQUENCE[0] ? 1 : 0
      }
    },
    [trackProgress, onComplete],
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      const digit = Number(e.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= JUMP_KEYS.length) {
        handleKeyPress(digit - 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyPress])

  return { flash, handleKeyPress }
}
