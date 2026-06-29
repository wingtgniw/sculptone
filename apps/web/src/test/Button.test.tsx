import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../ui/Button'

describe('Button', () => {
  it('라벨을 렌더하고 클릭을 전달한다', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>내보내기</Button>)
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('variant에 따라 data-variant 속성을 단다', () => {
    render(<Button variant="primary">A</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', 'primary')
  })
})
