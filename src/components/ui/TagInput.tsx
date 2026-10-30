import { useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'

const TONE_CLASSES = {
  brand: 'bg-brand-50 text-brand-800 ring-brand-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
} as const

export type TagTone = keyof typeof TONE_CLASSES

type TagInputProps = {
  id: string
  label: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  hint?: string
  suggestions?: readonly string[]
  tone?: TagTone
  disabled?: boolean
}

const MAX_TAGS = 20

/**
 * Campo de etiquetas libres con sugerencias rápidas.
 * Enter o coma agregan; Backspace con el campo vacío quita la última.
 * Se usa para alergias, condiciones médicas y medicación actual (columnas
 * `text[]` de `patients`).
 */
export function TagInput({
  id,
  label,
  value,
  onChange,
  placeholder = 'Escribí y presioná Enter…',
  hint,
  suggestions = [],
  tone = 'brand',
  disabled = false,
}: TagInputProps) {
  const [draft, setDraft] = useState('')

  const availableSuggestions = suggestions
    .filter((suggestion) => !value.some((tag) => tag.toLowerCase() === suggestion.toLowerCase()))
    .slice(0, 6)

  const hintId = hint ? `${id}-hint` : undefined

  function addTag(rawValue: string) {
    const tag = rawValue.trim().replace(/\s+/g, ' ')

    if (!tag) return

    const alreadyAdded = value.some((item) => item.toLowerCase() === tag.toLowerCase())

    if (!alreadyAdded && value.length < MAX_TAGS) onChange([...value, tag])

    setDraft('')
  }

  function removeTag(tag: string) {
    onChange(value.filter((item) => item !== tag))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag(draft)
      return
    }

    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        <span className="text-[11px] font-medium text-slate-400">
          {value.length > 0 ? `${value.length} agregado${value.length === 1 ? '' : 's'}` : 'Opcional'}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2 py-2 transition-colors focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        {value.length > 0 && (
          <ul className="contents" aria-label={`${label} agregados`}>
            {value.map((tag) => (
              <li
                key={tag}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONE_CLASSES[tone]}`}
              >
                <span className="max-w-48 truncate">{tag}</span>
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  disabled={disabled}
                  aria-label={`Quitar ${tag}`}
                  className="rounded-full p-0.5 transition-colors hover:bg-white/70 disabled:opacity-50"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          id={id}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addTag(draft)}
          placeholder={value.length > 0 ? 'Agregar otra…' : placeholder}
          disabled={disabled}
          autoComplete="off"
          maxLength={60}
          aria-describedby={hintId}
          className="min-w-32 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
      </div>

      {hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-400">
          {hint}
        </p>
      )}

      {availableSuggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {availableSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              disabled={disabled}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs text-slate-500 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
            >
              <Plus className="size-3" aria-hidden="true" />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
