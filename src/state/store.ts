export type Screen = 'landing' | 'host-setup' | 'host-room' | 'join-setup' | 'join-room'

export interface AppState {
  screen: Screen
  roomCode: string
  selfName: string
}

type Listener = (state: AppState) => void

const state: AppState = {
  screen: 'landing',
  roomCode: '',
  selfName: '',
}

const listeners = new Set<Listener>()

export function getState(): AppState {
  return state
}

export function setState(partial: Partial<AppState>): void {
  Object.assign(state, partial)
  listeners.forEach((listener) => listener(state))
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
