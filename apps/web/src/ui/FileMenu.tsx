import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { useStore } from '../state/store'
import {
  createEmptyProject,
  createTrack,
  addTrack,
  projectToMidi,
  midiToProject,
  serializeProject,
  projectToMusicXML,
} from '@sculptone/score-model'
import { downloadBytes, downloadText, readFileAsArrayBuffer } from '../io/files'
import { downloadDataset } from '../dataset/bundle'

const btnStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 10px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border-strong)',
  cursor: 'pointer',
  background: 'var(--bg-elevated)',
  color: 'var(--text-mid)',
  whiteSpace: 'nowrap',
}

export function FileMenu() {
  const project = useStore((s) => s.project)
  const replaceProject = useStore((s) => s.replaceProject)
  const fileInput = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const handleExportDataset = async () => {
    setIsExporting(true)
    setExportError(null)
    try {
      await downloadDataset(project)
    } catch (err) {
      console.error('[FileMenu] Dataset export failed:', err)
      setExportError('데이터셋 내보내기 실패')
    } finally {
      setIsExporting(false)
    }
  }

  const handleNew = () => {
    replaceProject(addTrack(createEmptyProject('Untitled Project'), createTrack('Piano')))
  }

  const handleExportMidi = () => {
    const bytes = projectToMidi(project)
    const filename = `${project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'}.mid`
    downloadBytes(bytes, filename, 'audio/midi')
  }

  const handleExportJson = () => {
    const json = serializeProject(project)
    const filename = `${project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'}.json`
    downloadText(json, filename, 'application/json')
  }

  const handleExportMusicXML = () => {
    const xml = projectToMusicXML(project)
    const filename = `${project.metadata.title.replace(/[^a-z0-9]/gi, '_') || 'untitled'}.musicxml`
    downloadText(xml, filename, 'application/vnd.recordare.musicxml+xml')
  }

  const handleImportMidi = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const buf = await readFileAsArrayBuffer(file)
      const bytes = new Uint8Array(buf)
      const title = file.name.replace(/\.midi?$/i, '')
      replaceProject(midiToProject(bytes, title))
      setImportError(null)
    } catch (err) {
      console.error('MIDI import failed:', err)
      setImportError('MIDI 파일을 불러올 수 없습니다.')
    } finally {
      // input 초기화 (같은 파일 재선택 허용)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button style={btnStyle} onClick={handleNew}>
        New
      </button>
      <button style={btnStyle} onClick={handleExportMidi}>
        Export MIDI
      </button>
      <button style={btnStyle} onClick={handleExportJson}>
        Export JSON
      </button>
      <button style={btnStyle} onClick={handleExportMusicXML}>
        Export MusicXML
      </button>
      <button style={btnStyle} onClick={handleExportDataset} disabled={isExporting}>
        {isExporting ? 'Exporting...' : 'Export Training Data'}
      </button>
      {exportError && (
        <span style={{ fontSize: 11, color: 'var(--record)', whiteSpace: 'nowrap' }}>
          {exportError}
        </span>
      )}
      <button style={btnStyle} onClick={() => fileInput.current?.click()}>
        Import MIDI
      </button>
      {/* hidden file input */}
      <input
        ref={fileInput}
        type="file"
        accept=".mid,.midi"
        style={{ display: 'none' }}
        onChange={handleImportMidi}
      />
      {importError && (
        <span style={{ fontSize: 11, color: 'var(--record)', whiteSpace: 'nowrap' }}>
          {importError}
        </span>
      )}
    </div>
  )
}
