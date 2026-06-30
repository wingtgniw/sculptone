export function ticksToSeconds(ticks: number, ppq: number, tempo: number): number {
  return (ticks / ppq) * (60 / tempo)
}
export function secondsToTicks(seconds: number, ppq: number, tempo: number): number {
  return ((seconds * tempo) / 60) * ppq
}
