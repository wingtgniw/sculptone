import type { ChangeEvent } from 'react'
import type { MidiDevice } from './useMidi'

interface Props {
  devices: MidiDevice[]
  selectedDeviceId: string | null
  selectDevice: (id: string | null) => void
  isSupported: boolean
  accessError: string | null
}

export function MidiDeviceSelect({
  devices,
  selectedDeviceId,
  selectDevice,
  isSupported,
  accessError,
}: Props) {
  if (!isSupported) {
    return (
      <span style={{ fontSize: 11, color: 'var(--record)', whiteSpace: 'nowrap' }}>
        Web MIDI 미지원
      </span>
    )
  }

  if (devices.length === 0) {
    return (
      <span style={{ fontSize: 11, color: 'var(--text-lo)', whiteSpace: 'nowrap' }}>
        {accessError ? `MIDI 오류: ${accessError}` : '장치 없음'}
      </span>
    )
  }

  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    selectDevice(val === '' ? null : val)
  }

  return (
    <select
      aria-label="MIDI Device"
      value={selectedDeviceId ?? ''}
      onChange={handleChange}
      style={{
        font: 'inherit',
        fontSize: 11,
        padding: '3px 6px',
        borderRadius: 'var(--r-sm)',
        border: '1px solid var(--border)',
        cursor: 'pointer',
        background: 'var(--bg-elevated)',
        color: 'var(--text-mid)',
        whiteSpace: 'nowrap',
      }}
    >
      <option value="">— MIDI 입력 선택 —</option>
      {devices.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  )
}
