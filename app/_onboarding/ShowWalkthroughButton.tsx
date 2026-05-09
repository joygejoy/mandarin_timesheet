'use client'

import { ONBOARDING_SHOW_EVENT, ONBOARDING_STATE_KEY } from './dismissKey'

export function ShowWalkthroughButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.localStorage.setItem(ONBOARDING_STATE_KEY, 'open')
        window.dispatchEvent(new Event(ONBOARDING_SHOW_EVENT))
      }}
      className="btn-secondary"
    >
      Show walkthrough
    </button>
  )
}
