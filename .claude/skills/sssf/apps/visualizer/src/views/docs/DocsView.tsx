import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { CSSProperties } from 'react'
import { BookOpen } from 'lucide-react'
import { CopyPlate } from '@/components/CopyPlate'
import { Stamp } from '@/components/Stamp'
import { cx } from '@/components/cx'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { navigate } from '@/router'
import { GROUPS } from './commands'
import s from './DocsView.module.css'

/**
 * The commands page — the shop window onto the stamped justfile (DESIGN_SPEC
 * §5.4). Static content, so the staggered reveal runs on mount unconditionally:
 * nothing here polls, so nothing can re-trigger it.
 */
export function DocsView() {
  const ids = useMemo(() => GROUPS.flatMap((g) => g.commands.map((c) => c.cmd)), [])
  const rowsRef = useRef(new Map<string, HTMLElement>())

  // Enter copies the selected command by driving its own CopyPlate, so the
  // 1400ms Copy→Check feedback is identical whether it was a click or a key.
  const onActivate = useCallback((id: string) => {
    rowsRef.current.get(id)?.querySelector('button')?.click()
  }, [])

  const nav = useListKeyboardNav({ ids, onActivate, onEscape: () => navigate() })
  const containerRef = nav.containerProps.ref

  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true })
  }, [containerRef])

  return (
    <div {...nav.containerProps} className={s.docs}>
      <header className={cx('plate', s.head)}>
        <BookOpen className={s.icon} size={20} strokeWidth={2} aria-hidden="true" />
        <div className={s.headBody}>
          <h1 className={s.title}>Commands</h1>
          <p className={s.sub}>
            Every recipe the stamped <code className={cx('well', s.inline)}>justfile</code> ships,
            runnable from the repo root.{' '}
            <code className={cx('well', s.inline)}>SSSF_CONFIG=other.yaml</code> before any of them
            swaps the whole roster for one run. Click a command to copy it.
          </p>
        </div>
        <Stamp className={s.hint}>J K move · Enter copy · Esc back</Stamp>
      </header>

      {GROUPS.map((g, gi) => (
        <section
          key={g.title}
          className={cx('plate', 'stagger-item', s.group)}
          style={{ '--accent': g.accent, '--i': gi } as CSSProperties}
        >
          <div className={s.groupHead}>
            <h2 className={s.groupTitle}>{g.title}</h2>
            <span className={s.filler} aria-hidden="true" />
          </div>
          <p className={s.blurb}>{g.blurb}</p>

          <div className={s.cmds}>
            {g.commands.map((c) => {
              const copyText = c.example ?? c.cmd
              const item = nav.itemProps(c.cmd)
              return (
                <div
                  key={c.cmd}
                  className={s.cmd}
                  data-selected={item['data-selected']}
                  ref={(el) => {
                    item.ref(el)
                    if (el) rowsRef.current.set(c.cmd, el)
                    else rowsRef.current.delete(c.cmd)
                  }}
                >
                  <CopyPlate
                    className={s.copy}
                    text={copyText}
                    label={c.cmd}
                    title={`copy: ${copyText}`}
                    accent={g.accent}
                  />
                  <div className={s.body}>
                    <p className={s.what}>{c.what}</p>
                    {c.example ? (
                      <code className={cx('well', s.example)}>{c.example}</code>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
