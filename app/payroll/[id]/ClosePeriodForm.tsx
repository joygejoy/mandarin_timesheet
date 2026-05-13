'use client'

import { useTransition } from 'react'
import { setPayPeriodStatus } from '../actions'
import type { PayPeriod } from '@/lib/types/db'

export function ClosePeriodForm({ id, status }: { id: string; status: PayPeriod['status'] }) {
  const [pending, startTransition] = useTransition()

  function go(target: PayPeriod['status']) {
    startTransition(async () => {
      await setPayPeriodStatus(id, target)
    })
  }

  if (status === 'open') {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm('Close this pay period? You can still re-open it later.')) return
          go('closed')
        }}
        className="btn-secondary"
      >
        {pending ? '…' : 'Close period'}
      </button>
    )
  }
  if (status === 'closed') {
    return (
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => go('open')}
          className="btn-secondary"
        >
          {pending ? '…' : 'Re-open'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => go('exported')}
          className="btn-primary"
        >
          {pending ? '…' : 'Mark exported'}
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => go('open')}
      className="btn-secondary"
    >
      {pending ? '…' : 'Re-open'}
    </button>
  )
}
