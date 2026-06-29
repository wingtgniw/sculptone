import { create } from 'zustand'
import {
  createEmptyProject,
  createTrack,
  addTrack,
  type Project,
} from '@sculptone/score-model'

export type Mode = 'compose' | 'play' | 'transcribe'

export interface AppState {
  activeMode: Mode
  project: Project
  setMode: (mode: Mode) => void
  setProject: (project: Project) => void
}

function initialProject(): Project {
  return addTrack(createEmptyProject('Untitled Project'), createTrack('Piano'))
}

export const useStore = create<AppState>((set) => ({
  activeMode: 'compose',
  project: initialProject(),
  setMode: (mode) => set({ activeMode: mode }),
  setProject: (project) => set({ project }),
}))
