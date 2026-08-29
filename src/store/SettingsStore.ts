/**
 * SettingsStore.ts
 *
 * Simple Zustand-like store using useSyncExternalStore to manage player preferences.
 */
import { useSyncExternalStore } from 'react'

export interface SettingsState {
  mouseSensitivity: number
  lightBrightness: number
  interactKey: string
  pickUpKey: string
  disconnectKey: string
  connectKey: string
}

class SettingsStoreClass {
  private state: SettingsState = {
    mouseSensitivity: 0.0018, // Default
    lightBrightness: 1.0,     // Default multiplier
    interactKey: 'E',
    pickUpKey: 'P',
    disconnectKey: 'D',
    connectKey: 'C',
  }

  private listeners = new Set<() => void>()

  public getState = () => this.state

  public subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public update = (partial: Partial<SettingsState>) => {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach(l => l())
  }
}

export const SettingsStore = new SettingsStoreClass()

export function useSettingsStore(): SettingsState {
  return useSyncExternalStore(SettingsStore.subscribe, SettingsStore.getState, SettingsStore.getState)
}
