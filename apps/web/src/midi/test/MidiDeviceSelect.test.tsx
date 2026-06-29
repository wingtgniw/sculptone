import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MidiDeviceSelect } from '../MidiDeviceSelect'
import type { MidiDevice } from '../useMidi'

const devices: MidiDevice[] = [
  { id: 'dev-1', name: 'Piano' },
  { id: 'dev-2', name: 'Synth' },
]

describe('MidiDeviceSelect', () => {
  it('장치 목록이 드롭다운 옵션으로 렌더된다', () => {
    render(
      <MidiDeviceSelect
        devices={devices}
        selectedDeviceId={null}
        selectDevice={() => {}}
        isSupported={true}
        accessError={null}
      />
    )
    expect(screen.getByRole('option', { name: 'Piano' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Synth' })).toBeInTheDocument()
  })

  it('장치 선택 시 selectDevice가 해당 id로 호출된다', async () => {
    const selectDevice = vi.fn()
    render(
      <MidiDeviceSelect
        devices={devices}
        selectedDeviceId={null}
        selectDevice={selectDevice}
        isSupported={true}
        accessError={null}
      />
    )
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /midi device/i }), 'dev-1')
    expect(selectDevice).toHaveBeenCalledWith('dev-1')
  })

  it('장치 없음(devices=[]) → "장치 없음" 메시지 표시', () => {
    render(
      <MidiDeviceSelect
        devices={[]}
        selectedDeviceId={null}
        selectDevice={() => {}}
        isSupported={true}
        accessError={null}
      />
    )
    expect(screen.getByText(/장치 없음/)).toBeInTheDocument()
  })

  it('isSupported=false → "Web MIDI 미지원" 메시지 표시', () => {
    render(
      <MidiDeviceSelect
        devices={[]}
        selectedDeviceId={null}
        selectDevice={() => {}}
        isSupported={false}
        accessError={null}
      />
    )
    expect(screen.getByText(/Web MIDI 미지원/)).toBeInTheDocument()
  })

  // C-1(1): accessError 상태 시 에러 안내 텍스트 표시
  it('accessError 있을 때 에러 안내 텍스트를 표시한다', () => {
    render(
      <MidiDeviceSelect
        devices={[]}
        selectedDeviceId={null}
        selectDevice={() => {}}
        isSupported={true}
        accessError="SecurityError"
      />
    )
    expect(screen.getByText('MIDI 오류: SecurityError')).toBeInTheDocument()
  })

  // C-1(2): 플레이스홀더/빈 옵션 선택 시 selectDevice(null) 호출
  it('플레이스홀더 선택 시 selectDevice(null)이 호출된다', async () => {
    const selectDevice = vi.fn()
    render(
      <MidiDeviceSelect
        devices={devices}
        selectedDeviceId="dev-1"
        selectDevice={selectDevice}
        isSupported={true}
        accessError={null}
      />
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /midi device/i }),
      '',
    )
    expect(selectDevice).toHaveBeenCalledWith(null)
  })
})
