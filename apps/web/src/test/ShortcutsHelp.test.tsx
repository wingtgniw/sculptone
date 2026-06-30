import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShortcutsHelp } from '../shell/ShortcutsHelp'
import { useStore } from '../state/store'

describe('ShortcutsHelp', () => {
  beforeEach(() => {
    useStore.setState(useStore.getInitialState(), true)
  })

  it('showShortcuts=false이면 dialog를 렌더하지 않는다', () => {
    render(<ShortcutsHelp />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('showShortcuts=true이면 role="dialog"를 렌더한다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('단축키 목록에 "재생 / 정지"가 표시된다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByText(/재생 \/ 정지/)).toBeInTheDocument()
  })

  it('"Space" 키 레이블이 표시된다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    expect(screen.getByText('Space')).toBeInTheDocument()
  })

  it('닫기 버튼 클릭 시 showShortcuts가 false로 변경된다', async () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    await userEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  it('배경(backdrop) 클릭 시 showShortcuts가 false로 변경된다', async () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    // dialog 역할 요소 자체(배경 레이어)를 클릭
    fireEvent.click(screen.getByRole('dialog'))
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  // Fix #3a: Esc 키로 닫기 — 열린 상태
  it('showShortcuts=true 상태에서 Esc 키 → showShortcuts가 false로 변경된다', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  // Fix #3b: Esc 키 no-op — 닫힌 상태 (리스너 미등록)
  it('showShortcuts=false 상태에서 Esc 키는 no-op이다 (리스너 미등록)', () => {
    render(<ShortcutsHelp />)
    expect(useStore.getState().showShortcuts).toBe(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    // 값이 바뀌지 않아야 한다
    expect(useStore.getState().showShortcuts).toBe(false)
  })

  // Fix #4: 패널 내부 클릭 시 모달 유지 (stopPropagation 보호)
  it('패널 내부 요소 클릭 시 모달이 닫히지 않는다 (stopPropagation 보호)', () => {
    useStore.setState({ showShortcuts: true })
    render(<ShortcutsHelp />)
    // 패널 내부 제목 텍스트를 클릭 — 배경까지 propagate되지 않아야 한다
    fireEvent.click(screen.getByText('키보드 단축키'))
    expect(useStore.getState().showShortcuts).toBe(true)
  })
})
