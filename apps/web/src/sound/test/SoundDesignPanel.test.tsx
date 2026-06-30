import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { updateTrackSound } from '@sculptone/score-model'

// Tone.start 모킹 (AudioContext 초기화 방지)
vi.mock('tone', () => ({
  start: vi.fn().mockResolvedValue(undefined),
}))

// PatchLibrary를 mock해 fake-indexeddb 없이 SoundDesignPanel 테스트 격리
vi.mock('../PatchLibrary', () => ({
  PatchLibrary: ({ trackId }: { trackId: string; currentSound: unknown }) => (
    <div data-testid="patch-library-mock" data-track-id={trackId} />
  ),
}))

// createInstrumentFromSound → preview만 사용, Tone 초기화 방지
vi.mock('@sculptone/sound-engine', () => ({
  listPresets: vi.fn(() => [
    { id: 'acoustic-piano', label: 'Acoustic Piano', kind: 'sampler', source: 'salamander' },
    { id: 'synth-lead', label: 'Synth Lead', kind: 'synth', source: 'Synth' },
    { id: 'electric-piano', label: 'Electric Piano', kind: 'synth', source: 'AMSynth' },
  ]),
  createInstrumentFromSound: vi.fn(() => ({
    triggerAttackRelease: vi.fn(),
    volume: { value: 0 },
    dispose: vi.fn(),
  })),
}))

import * as Tone from 'tone'
import { SoundDesignPanel } from '../SoundDesignPanel'

const BASE_PATCH = {
  kind: 'patch' as const,
  engine: 'synth' as const,
  envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
}

describe('SoundDesignPanel', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('soundPanelTrackId가 null이면 아무것도 렌더하지 않는다', () => {
    const { container } = render(<SoundDesignPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('soundPanelTrackId가 설정되면 dialog role의 패널이 열린다', () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('dialog', { name: /sound design/i })).toBeInTheDocument()
  })

  it('preset sound이면 "Sound preset" 드롭다운이 표시된다', () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('combobox', { name: /sound preset/i })).toBeInTheDocument()
  })

  it('"Switch to Patch" 버튼 클릭 시 sound.kind가 patch가 된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('button', { name: /switch to (custom )?patch/i }))
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind).toBe('patch')
  })

  it('patch sound이면 Engine 드롭다운이 표시된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('combobox', { name: /synth engine/i })).toBeInTheDocument()
  })

  it('patch sound이면 ADSR 슬라이더가 4개 이상 존재한다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    expect(screen.getAllByRole('slider').length).toBeGreaterThanOrEqual(4)
  })

  it('Engine 드롭다운 변경 시 sound.engine이 갱신된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /synth engine/i }), 'fm')
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && (updated.sound as { engine: string }).engine).toBe(
      'fm',
    )
  })

  it('Attack 슬라이더 변경 시 envelope.attack이 갱신된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    fireEvent.change(screen.getByRole('slider', { name: /envelope attack/i }), {
      target: { value: '0.5' },
    })
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind).toBe('patch')
    if (updated.sound.kind === 'patch') expect(updated.sound.envelope.attack).toBeCloseTo(0.5)
  })

  it('Filter 체크박스 활성화 시 Filter type 드롭다운이 나타난다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /enable filter/i }))
    expect(screen.getByRole('combobox', { name: /filter type/i })).toBeInTheDocument()
  })

  it('Reverb 체크박스 활성화 시 effects에 reverb가 추가된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /enable reverb/i }))
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind).toBe('patch')
    if (updated.sound.kind === 'patch') {
      expect(updated.sound.effects?.some((fx) => fx.type === 'reverb')).toBe(true)
    }
  })

  it('닫기 버튼 클릭 시 soundPanelTrackId가 null이 된다', async () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('button', { name: /close sound panel/i }))
    expect(useStore.getState().soundPanelTrackId).toBeNull()
  })

  it('프리뷰 버튼이 존재하고 클릭해도 오류가 없다(스모크)', async () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    expect(screen.getByRole('button', { name: /preview sound/i })).toBeInTheDocument()
    await expect(
      userEvent.click(screen.getByRole('button', { name: /preview sound/i })),
    ).resolves.not.toThrow()
  })

  it('"Use Preset Instead" 버튼 클릭 시 sound.kind가 preset으로 돌아온다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('button', { name: /use preset instead/i }))
    expect(useStore.getState().project.tracks[0]!.sound.kind).toBe('preset')
  })

  it('reverb decay 슬라이더의 min은 0.1이고 wet 슬라이더의 min은 0이다(Fix 1 회귀)', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(
      updateTrackSound(s.project, trackId, {
        ...BASE_PATCH,
        effects: [{ type: 'reverb' as const, wet: 0.3, decay: 2 }],
      }),
    )
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    const decaySlider = screen.getByRole('slider', { name: /reverb decay/i })
    const wetSlider = screen.getByRole('slider', { name: /reverb wet/i })
    expect(decaySlider).toHaveAttribute('min', '0.1')
    expect(wetSlider).toHaveAttribute('min', '0')
  })

  it('preview 클릭 시 Tone.start가 호출된다(Fix 2 스모크)', async () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('button', { name: /preview sound/i }))
    expect(vi.mocked(Tone.start)).toHaveBeenCalled()
  })
})

describe('SoundDesignPanel — PatchLibrary 통합', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('patch 모드에서 PatchLibrary(mock)가 렌더된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(updateTrackSound(s.project, trackId, BASE_PATCH))
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    expect(screen.getByTestId('patch-library-mock')).toBeInTheDocument()
  })

  it('preset 모드에서 PatchLibrary가 렌더되지 않는다', () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    // 기본 트랙은 preset sound
    render(<SoundDesignPanel />)
    expect(screen.queryByTestId('patch-library-mock')).not.toBeInTheDocument()
  })
})

describe('SoundDesignPanel — Oscillator 섹션', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  function openPatchPanel() {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(
      updateTrackSound(s.project, trackId, {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
      }),
    )
    s.setSoundPanelTrackId(trackId)
  }

  it('patch 모드에서 Oscillator type 드롭다운이 표시된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    expect(screen.getByRole('combobox', { name: /oscillator type/i })).toBeInTheDocument()
  })

  it('Oscillator type 변경 시 sound.oscillator.type이 갱신된다', async () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /oscillator type/i }),
      'square',
    )
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.oscillator?.type).toBe('square')
  })

  it('patch 모드에서 Oscillator Detune 슬라이더가 표시된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    expect(screen.getByRole('slider', { name: /oscillator detune/i })).toBeInTheDocument()
  })

  it('Detune 슬라이더 변경 시 sound.oscillator.detune이 갱신된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    fireEvent.change(screen.getByRole('slider', { name: /oscillator detune/i }), {
      target: { value: '200' },
    })
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.oscillator?.detune).toBe(200)
  })
})

describe('SoundDesignPanel — 미커버 핸들러 보강', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  it('Preset select 변경 시 sound.presetId가 갱신된다', async () => {
    const s = useStore.getState()
    s.setSoundPanelTrackId(s.selectedTrackId)
    render(<SoundDesignPanel />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /sound preset/i }),
      'synth-lead',
    )
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'preset' && updated.sound.presetId).toBe('synth-lead')
  })

  it('Filter 활성화 후 Filter type 변경 시 filter.type이 갱신된다', async () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(
      updateTrackSound(s.project, trackId, {
        ...BASE_PATCH,
        filter: { type: 'lowpass' as const, frequency: 2000, Q: 1 },
      }),
    )
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /filter type/i }),
      'highpass',
    )
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.filter?.type).toBe('highpass')
  })

  it('Filter 활성화 후 Cutoff 슬라이더 변경 시 filter.frequency가 갱신된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(
      updateTrackSound(s.project, trackId, {
        ...BASE_PATCH,
        filter: { type: 'lowpass' as const, frequency: 2000, Q: 1 },
      }),
    )
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    fireEvent.change(screen.getByRole('slider', { name: /filter frequency/i }), {
      target: { value: '5000' },
    })
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.filter?.frequency).toBe(5000)
  })

  it('Reverb 활성화 후 Wet 슬라이더 변경 시 reverb.wet이 갱신된다', () => {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(
      updateTrackSound(s.project, trackId, {
        ...BASE_PATCH,
        effects: [{ type: 'reverb' as const, wet: 0.3, decay: 2 }],
      }),
    )
    s.setSoundPanelTrackId(trackId)
    render(<SoundDesignPanel />)
    fireEvent.change(screen.getByRole('slider', { name: /reverb wet/i }), {
      target: { value: '0.7' },
    })
    const updated = useStore.getState().project.tracks[0]!
    if (updated.sound.kind === 'patch') {
      const reverbFx = (updated.sound.effects ?? []).find((fx) => fx.type === 'reverb') as
        { type: 'reverb'; wet: number; decay: number } | undefined
      expect(reverbFx?.wet).toBeCloseTo(0.7)
    }
  })
})

describe('SoundDesignPanel — LFO 섹션', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
    vi.clearAllMocks()
  })

  function openPatchPanel() {
    const s = useStore.getState()
    const trackId = s.selectedTrackId
    s.setProject(
      updateTrackSound(s.project, trackId, {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
      }),
    )
    s.setSoundPanelTrackId(trackId)
  }

  it('patch 모드에서 LFO Enable 체크박스가 표시된다', () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    expect(screen.getByRole('checkbox', { name: /lfo enable/i })).toBeInTheDocument()
  })

  it('LFO Enable 체크박스 활성화 시 target·rate·depth 컨트롤이 나타난다', async () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /lfo enable/i }))
    expect(screen.getByRole('combobox', { name: /lfo target/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /lfo rate/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /lfo depth/i })).toBeInTheDocument()
  })

  it('LFO Enable 체크박스 활성화 시 sound.lfo가 기본값으로 설정된다', async () => {
    openPatchPanel()
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /lfo enable/i }))
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo).toEqual({
      target: 'amplitude',
      rate: 1,
      depth: 0.5,
    })
  })

  it('LFO rate 슬라이더 변경 시 sound.lfo.rate가 갱신된다', async () => {
    openPatchPanel()
    const s = useStore.getState()
    // LFO 있는 patch로 설정
    s.setProject(
      updateTrackSound(s.project, s.selectedTrackId, {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
        lfo: { target: 'filter', rate: 1, depth: 0.5 },
      }),
    )
    render(<SoundDesignPanel />)
    fireEvent.change(screen.getByRole('slider', { name: /lfo rate/i }), { target: { value: '5' } })
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo?.rate).toBe(5)
  })

  it('LFO target select 변경 시 sound.lfo.target이 갱신된다', async () => {
    openPatchPanel()
    const s = useStore.getState()
    s.setProject(
      updateTrackSound(s.project, s.selectedTrackId, {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
        lfo: { target: 'amplitude', rate: 1, depth: 0.5 },
      }),
    )
    render(<SoundDesignPanel />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /lfo target/i }), 'filter')
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo?.target).toBe('filter')
  })

  it('LFO depth 슬라이더 변경 시 sound.lfo.depth가 갱신된다', () => {
    openPatchPanel()
    const s = useStore.getState()
    s.setProject(
      updateTrackSound(s.project, s.selectedTrackId, {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
        lfo: { target: 'amplitude', rate: 1, depth: 0.5 },
      }),
    )
    render(<SoundDesignPanel />)
    fireEvent.change(screen.getByRole('slider', { name: /lfo depth/i }), {
      target: { value: '0.8' },
    })
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo?.depth).toBeCloseTo(0.8)
  })

  it('LFO Enable 체크박스 비활성화 시 sound.lfo가 undefined가 된다', async () => {
    openPatchPanel()
    const s = useStore.getState()
    s.setProject(
      updateTrackSound(s.project, s.selectedTrackId, {
        kind: 'patch' as const,
        engine: 'synth' as const,
        envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.1 },
        lfo: { target: 'pitch', rate: 2, depth: 0.3 },
      }),
    )
    render(<SoundDesignPanel />)
    await userEvent.click(screen.getByRole('checkbox', { name: /lfo enable/i }))
    const updated = useStore.getState().project.tracks[0]!
    expect(updated.sound.kind === 'patch' && updated.sound.lfo).toBeUndefined()
  })
})
