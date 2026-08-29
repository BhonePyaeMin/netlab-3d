/**
 * useNetworkStore.ts
 *
 * React hook to subscribe to NetworkStore state.
 * Uses useSyncExternalStore for concurrent-safe reads.
 *
 * Usage:
 *   const { cables, ports, links, heldCableId } = useNetworkStore()
 */
import { useSyncExternalStore } from 'react'
import { NetworkStore }         from './NetworkStore'
import type { NetworkState }    from './NetworkStore'

export function useNetworkStore(): NetworkState {
  return useSyncExternalStore(
    NetworkStore.subscribe,
    NetworkStore.getSnapshot,
    NetworkStore.getSnapshot,  // server snapshot (same for SSR compat)
  )
}
