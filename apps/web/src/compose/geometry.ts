export const LANE_HEIGHT = 24
export const PX_PER_BEAT = 48
export const PITCH_LOW = 36
export const PITCH_HIGH = 84
export const NOTE_HEIGHT = 16

export function pxPerTick(ppq: number): number {
  return PX_PER_BEAT / ppq
}
export function tickToX(tick: number, ppq: number): number {
  return tick * pxPerTick(ppq)
}
export function xToTick(x: number, ppq: number): number {
  return x / pxPerTick(ppq)
}
export function pitchToY(pitch: number, laneHeight: number = LANE_HEIGHT): number {
  return (PITCH_HIGH - pitch) * laneHeight
}
export function yToPitch(y: number, laneHeight: number = LANE_HEIGHT): number {
  return PITCH_HIGH - Math.floor(y / laneHeight)
}
export function durationToWidth(duration: number, ppq: number): number {
  return duration * pxPerTick(ppq)
}
export function rollHeight(laneHeight: number = LANE_HEIGHT): number {
  return (PITCH_HIGH - PITCH_LOW + 1) * laneHeight
}
