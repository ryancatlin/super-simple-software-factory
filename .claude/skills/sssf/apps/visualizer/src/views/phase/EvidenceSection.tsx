import { cx } from '@/components/cx'
import { evidenceFileUrl } from '@/lib/api'
import type { EvidenceFile } from '@/lib/api'
import { fmtSize } from './phaseData'
import type { EvidencePanelRow } from './useEvidence'
import s from './EvidenceSection.module.css'

export interface EvidenceSectionProps {
  adwId: string
  panels: EvidencePanelRow[]
}

/**
 * What a capture phase actually saw: screenshots and diffs inline, sidecars
 * (OCR, page text, toolkit.txt) as one-click text links.
 */
export function EvidenceSection({ adwId, panels }: EvidenceSectionProps) {
  const url = (dir: string, file: EvidenceFile) => evidenceFileUrl(adwId, `${dir}/${file.name}`)
  return (
    <>
      {panels.map((flow) => (
        <div key={flow.dir} className={s.flow}>
          <div className={cx('stamp', s.name)}>{flow.dir}</div>
          {flow.images.length ? (
            <div className={s.grid}>
              {flow.images.map((img) => (
                <a
                  key={img.name}
                  className={cx(s.thumb, img.name.endsWith('.diff.png') && s.diff)}
                  href={url(flow.dir, img)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${img.name} — open full size`}
                >
                  <img src={url(flow.dir, img)} alt={img.name} loading="lazy" />
                  <span className={s.cap}>
                    {img.name} <span className={cx(s.size, 'tnum')}>{fmtSize(img.size)}</span>
                  </span>
                </a>
              ))}
            </div>
          ) : null}
          {flow.texts.length ? (
            <div className={s.files}>
              {flow.texts.map((f) => (
                <a
                  key={f.name}
                  className={s.file}
                  href={url(flow.dir, f)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {f.name} <span className={cx(s.size, 'tnum')}>{fmtSize(f.size)}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </>
  )
}
