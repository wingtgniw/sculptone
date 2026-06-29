import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from '../ui/Tabs'

const items = [
  { id: 'compose', label: 'Compose' },
  { id: 'play', label: 'Play' },
  { id: 'transcribe', label: 'Transcribe', disabled: true },
]

describe('Tabs', () => {
  it('활성 탭에 aria-selected를 부여한다', () => {
    render(<Tabs items={items} active="compose" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Compose' })).toHaveAttribute('aria-selected', 'true')
  })

  it('비활성 탭 클릭은 onChange를 호출하지 않는다', async () => {
    const onChange = vi.fn()
    render(<Tabs items={items} active="compose" onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Transcribe' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('활성 가능한 탭 클릭은 onChange(id)를 호출한다', async () => {
    const onChange = vi.fn()
    render(<Tabs items={items} active="compose" onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Play' }))
    expect(onChange).toHaveBeenCalledWith('play')
  })
})
