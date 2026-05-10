import { logoutAction } from '../_actions/logout'

export function LogoutButton({ className }: { className?: string }) {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className={
          className ??
          'w-full rounded-md border-l-2 border-transparent px-2 py-1.5 text-left text-sm text-[color:var(--muted)] transition hover:bg-black/5 hover:text-[color:var(--foreground)] dark:hover:bg-white/5'
        }
      >
        Sign out
      </button>
    </form>
  )
}
