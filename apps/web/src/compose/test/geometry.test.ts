import { describe, it, expect } from 'vitest'
import {
  LANE_HEIGHT,
  PITCH_HIGH,
  pxPerTick,
  tickToX,
  xToTick,
  pitchToY,
  yToPitch,
  durationToWidth,
  rollHeight,
} from '../geometry'

describe('geometry', () => {
  const ppq = 480
  it('pxPerTick = PX_PER_BEAT / ppq', () => {
    expect(pxPerTick(ppq)).toBeCloseTo(0.1)
  })
  it('tickToX / xToTick 라운드트립', () => {
    expect(tickToX(960, ppq)).toBeCloseTo(96)
    expect(xToTick(96, ppq)).toBeCloseTo(960)
  })
  it('pitchToY: 높은 음일수록 위(작은 y)', () => {
    expect(pitchToY(PITCH_HIGH, LANE_HEIGHT)).toBe(0)
    expect(pitchToY(PITCH_HIGH - 1, LANE_HEIGHT)).toBe(LANE_HEIGHT)
  })
  it('yToPitch: y=0 → PITCH_HIGH 레인', () => {
    expect(yToPitch(0, LANE_HEIGHT)).toBe(PITCH_HIGH)
    expect(yToPitch(LANE_HEIGHT, LANE_HEIGHT)).toBe(PITCH_HIGH - 1)
  })
  it('durationToWidth', () => {
    expect(durationToWidth(480, ppq)).toBeCloseTo(48)
  })
  it('rollHeight = 레인 수 * LANE_HEIGHT', () => {
    expect(rollHeight(24)).toBe(1176)
  })
})
