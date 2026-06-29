import { describe, it, expect } from 'vitest'
import { ticksToSeconds, secondsToTicks } from '../time'

describe('time', () => {
  it('120BPM, ppq480: 480tick(1박) = 0.5s', () => {
    expect(ticksToSeconds(480, 480, 120)).toBeCloseTo(0.5)
  })
  it('secondsToTicks 라운드트립', () => {
    expect(secondsToTicks(0.5, 480, 120)).toBeCloseTo(480)
  })
  it('60BPM: 480tick = 1s', () => {
    expect(ticksToSeconds(480, 480, 60)).toBeCloseTo(1)
  })
})
