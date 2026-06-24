import { app, autoUpdater, dialog } from 'electron'
import log from 'electron-log'
import settingsManager from './settings-manager.js'

const UPDATE_HOST = 'https://update.electronjs.org'
const UPDATE_REPO = 'p2plabsxyz/peersky-test'
const STARTUP_DELAY_MS = 10000
const CHECK_INTERVAL_MS = 60 * 60 * 1000

function getFeedUrl () {
  const formatSegment = process.windowsStore ? '/msix' : ''
  return `${UPDATE_HOST}/${UPDATE_REPO}/${process.platform}-${process.arch}${formatSegment}/${app.getVersion()}`
}

function safeCheckForUpdates () {
  // Electron's native autoUpdater.checkForUpdates() returns void (not a
  // Promise), so guard with try/catch rather than .catch().
  try {
    autoUpdater.checkForUpdates()
  } catch (err) {
    log.error('[auto-updater] checkForUpdates failed:', err?.message || err)
  }
}

function setupAutoUpdater () {
  if (!app.isPackaged) {
    log.info('[auto-updater] Dev mode (would check ' + getFeedUrl() +
      ' every 1h after a 10s delay). Build with electron-builder to test the real flow.')
    return
  }

  if (process.platform === 'linux') {
    log.info('[auto-updater] Skipping: Linux is handled by AppImage / distro packaging')
    return
  }

  if (settingsManager.settings.autoUpdateEnabled === false) {
    log.info('[auto-updater] Skipping: disabled in user settings')
    return
  }

  log.transports.file.level = 'info'

  const feedURL = getFeedUrl()
  log.info('[auto-updater] feedURL', feedURL)

  // update.electronjs.org returns JSON (or HTTP 204 when up to date),
  // so Squirrel must be told serverType: 'json' or it fails to parse the response.
  autoUpdater.setFeedURL({
    url: feedURL,
    serverType: 'json',
    headers: {
      'User-Agent': `peersky-test/${app.getVersion()} (${process.platform}: ${process.arch})`
    }
  })

  autoUpdater.on('checking-for-update', () => {
    log.info('[auto-updater] checking-for-update')
  })

  autoUpdater.on('update-available', () => {
    log.info('[auto-updater] update-available; downloading...')
  })

  autoUpdater.on('update-not-available', () => {
    log.info('[auto-updater] update-not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[auto-updater] download ${progress.percent?.toFixed(1) ?? 0}%`)
  })

  autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
    log.info('[auto-updater] update-downloaded:', releaseName || releaseNotes)
    const response = dialog.showMessageBoxSync({
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      title: 'Update Ready',
      message: releaseName || 'A new version is ready',
      detail: 'Restart now to install the update, or choose Later to postpone.'
    })
    if (response === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  autoUpdater.on('error', (err) => {
    log.error('[auto-updater] error:', err?.message || err)
  })

  setTimeout(() => {
    log.info('[auto-updater] Initialized')
    safeCheckForUpdates()
    setInterval(safeCheckForUpdates, CHECK_INTERVAL_MS)
  }, STARTUP_DELAY_MS)
}

export { setupAutoUpdater }
