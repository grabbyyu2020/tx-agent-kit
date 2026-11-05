// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShadowingShortcuts } from './useShadowingShortcuts'

const renderShortcuts = (enabled = true) => {
  const handlers = {
    onReplay: vi.fn<() => void>(),
    onNext: vi.fn<() => void>(),
    onPrevious: vi.fn<() => void>(),
    onToggleRate: vi.fn<() => void>(),
    onToggleSubtitle: vi.fn<() => void>()
  }
  const view = renderHook(() => useShadowingShortcuts({ ...handlers, enabled }))
  return { ...view, handlers }
}

const press = (init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('useShadowingShortcuts', () => {
  it('maps Space, arrows, S and H to the practice actions [INV-SHADOW-015]', () => {
    const { handlers } = renderShortcuts()

    const spaceEvent = press({ key: ' ', code: 'Space' })
    const rightEvent = press({ key: 'ArrowRight' })
    press({ key: 'ArrowLeft' })
    press({ key: 's' })
    press({ key: 'S', shiftKey: true })
    press({ key: 'h' })
    press({ key: 'H', shiftKey: true })

    expect(spaceEvent.defaultPrevented).toBe(true)
    expect(rightEvent.defaultPrevented).toBe(true)
    expect(handlers.onReplay).toHaveBeenCalledTimes(1)
    expect(handlers.onNext).toHaveBeenCalledTimes(1)
    expect(handlers.onPrevious).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleRate).toHaveBeenCalledTimes(2)
    expect(handlers.onToggleSubtitle).toHaveBeenCalledTimes(2)
  })

  it('ignores keys typed into inputs, textareas and contenteditable elements', () => {
    const { handlers } = renderShortcuts()
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.append(input, textarea, editable)

    const spaceInInput = press({ key: ' ' }, input)
    press({ key: 's' }, textarea)
    press({ key: 'ArrowRight' }, editable)

    expect(spaceInInput.defaultPrevented).toBe(false)
    expect(handlers.onReplay).not.toHaveBeenCalled()
    expect(handlers.onToggleRate).not.toHaveBeenCalled()
    expect(handlers.onNext).not.toHaveBeenCalled()
  })

  it('leaves Space to a focused button so keyboard users can activate it', () => {
    const { handlers } = renderShortcuts()
    const button = document.createElement('button')
    document.body.append(button)

    const event = press({ key: ' ' }, button)
    press({ key: 'ArrowRight' }, button)

    expect(event.defaultPrevented).toBe(false)
    expect(handlers.onReplay).not.toHaveBeenCalled()
    expect(handlers.onNext).toHaveBeenCalledTimes(1)
  })

  it('ignores shortcuts combined with Ctrl, Meta or Alt', () => {
    const { handlers } = renderShortcuts()

    press({ key: 's', ctrlKey: true })
    press({ key: 'ArrowRight', metaKey: true })
    press({ key: 'ArrowLeft', altKey: true })
    press({ key: 'h', ctrlKey: true })
    const space = press({ key: ' ', metaKey: true })

    expect(space.defaultPrevented).toBe(false)
    expect(handlers.onToggleRate).not.toHaveBeenCalled()
    expect(handlers.onNext).not.toHaveBeenCalled()
    expect(handlers.onPrevious).not.toHaveBeenCalled()
    expect(handlers.onToggleSubtitle).not.toHaveBeenCalled()
    expect(handlers.onReplay).not.toHaveBeenCalled()
  })

  it('does nothing when disabled and stops listening after unmount', () => {
    const disabled = renderShortcuts(false)
    press({ key: ' ' })
    expect(disabled.handlers.onReplay).not.toHaveBeenCalled()
    disabled.unmount()

    const enabled = renderShortcuts()
    enabled.unmount()
    press({ key: 'ArrowRight' })
    expect(enabled.handlers.onNext).not.toHaveBeenCalled()
  })
})
