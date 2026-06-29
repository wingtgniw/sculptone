import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore } from '../../state/store'
import { TracksPanel } from '../TracksPanel'

describe('TracksPanel', () => {
  beforeEach(() => { useStore.setState(useStore.getInitialState(), true) })
  it('트랙 목록을 렌더하고 현재 트랙을 aria-current로 표시', () => {
    render(<TracksPanel />)
    const row = screen.getByRole('button', { name: /Piano/ })
    expect(row).toHaveAttribute('aria-current', 'true')
  })
})
