import { type ComponentType, type CSSProperties, useState } from 'react'
import { Leva } from 'leva'
import ControlCenterDemo from '../demos/ControlCenterDemo'
import IosNotificationDemo from '../demos/IosNotificationDemo'
import MenuDemo from '../demos/MenuDemo'
import MusicSidebarDemo from '../demos/MusicSidebarDemo'
import NotificationCenterDemo from '../demos/NotificationCenterDemo'
import R3FIntegrationDemo from '../demos/R3FIntegrationDemo'
import VideoControlsDemo from '../demos/VideoControlsDemo'
import styles from './Showcase.module.css'

type Showcase = {
  id: string
  label: string
  Component: ComponentType
  sourcePath: string
  frameWidth?: number | string
}

type ShowcaseFrameStyle = CSSProperties & {
  '--showcase-frame-width'?: string
}

const showcases: Showcase[] = [
  {
    id: 'ios-notification',
    label: 'Notification',
    Component: IosNotificationDemo,
    sourcePath: 'apps/site/src/demos/IosNotificationDemo.tsx',
  },
  {
    id: 'video-controls',
    label: 'Video Controls',
    Component: VideoControlsDemo,
    sourcePath: 'apps/site/src/demos/VideoControlsDemo.tsx',
  },
  {
    id: 'music-sidebar',
    label: 'Music Sidebar',
    Component: MusicSidebarDemo,
    sourcePath: 'apps/site/src/demos/MusicSidebarDemo.tsx',
  },
  {
    id: 'control-center',
    label: 'Control Center',
    Component: ControlCenterDemo,
    sourcePath: 'apps/site/src/demos/ControlCenterDemo.tsx',
  },
  {
    id: 'menu',
    label: 'Menu',
    Component: MenuDemo,
    sourcePath: 'apps/site/src/demos/MenuDemo.tsx',
  },
  {
    id: 'r3f-integration',
    label: 'R3F Integration',
    Component: R3FIntegrationDemo,
    sourcePath: 'apps/site/src/demos/R3FIntegrationDemo.tsx',
  },
  {
    id: 'notification-center',
    label: 'Notification Center',
    Component: NotificationCenterDemo,
    sourcePath: 'apps/site/src/demos/NotificationCenterDemo.tsx',
    frameWidth: 300,
  },
]

const sourceBaseUrl = 'https://github.com/Gitguy268/glassform/blob/main/'

export default function Showcase() {
  const [selectedShowcaseId, setSelectedShowcaseId] = useState(showcases[0].id)
  const selectedShowcase =
    showcases.find((showcase) => showcase.id === selectedShowcaseId) ?? showcases[0]
  const SelectedShowcase = selectedShowcase.Component
  const showcaseFrameStyle: ShowcaseFrameStyle | undefined = selectedShowcase.frameWidth === undefined
    ? undefined
    : {
      '--showcase-frame-width': typeof selectedShowcase.frameWidth === 'number'
        ? `${selectedShowcase.frameWidth}px`
        : selectedShowcase.frameWidth,
    }

  return (
    <>
      <Leva hidden />
      <main className={styles.root}>
        {(
          <>
            <nav
              aria-label="Showcases"
              className={styles.tabBar}
            >
              {showcases.map((showcase) => (
                <button
                  key={showcase.id}
                  className={[
                    styles.tabButton,
                    showcase.id === selectedShowcase.id ? styles.tabButtonActive : '',
                  ].join(' ')}
                  type="button"
                  aria-pressed={showcase.id === selectedShowcase.id}
                  onClick={() => setSelectedShowcaseId(showcase.id)}
                >
                  {showcase.label}
                </button>
              ))}
            </nav>

            <label className={styles.mobilePicker}>
              <span className={styles.mobilePickerLabel}>Showcase</span>
              <select
                className={styles.mobileSelect}
                value={selectedShowcase.id}
                onChange={(event) => setSelectedShowcaseId(event.target.value)}
              >
                {showcases.map((showcase) => (
                  <option key={showcase.id} value={showcase.id}>
                    {showcase.label}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.stage}>
              <section className={styles.showcaseFrame} style={showcaseFrameStyle}>
                <SelectedShowcase key={selectedShowcase.id} />
              </section>
              <p className={styles.sourceCaption}>
                <a
                  href={`${sourceBaseUrl}${selectedShowcase.sourcePath}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View source on GitHub
                </a>
              </p>
            </div>
          </>
        )}
      </main>
    </>
  )
}
