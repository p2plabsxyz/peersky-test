import { app, autoUpdater as nativeUpdater, dialog } from 'electron'
import log from 'electron-log'
import electronUpdater from 'electron-updater'
import settingsManager from './settings-manager.js'

const UPDATE_HOST = 'https://update.electronjs.org'
const UPDATE_REPO = 'p2plabsxyz/peersky-browser'
const STARTUP_DELAY_MS = 10000
const CHECK_INTERVAL_MS = 60 * 60 * 1000

function getFeedUrl () {
  const formatSegment = process.windowsStore ? '/msix' : ''
  return `${UPDATE_HOST}/${UPDATE_REPO}/${process.platform}-${process.arch}${formatSegment}/${app.getVersion()}`
}

// Prompt the user once an update is staged. Returns true if they chose to
// restart immediately.
function promptRestart (releaseName) {
  const response = dialog.showMessageBoxSync({
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    title: 'Update Ready',
    message: releaseName || 'A new version is ready',
    detail: 'Restart now to install the update, or choose Later to postpone.'
  })
  return response === 0
}

// First check after a short startup delay, then on a fixed interval.
function scheduleChecks (check) {
  setTimeout(() => {
    log.info('[auto-updater] Initialized')
    check()
    setInterval(check, CHECK_INTERVAL_MS)
  }, STARTUP_DELAY_MS)
}

// macOS uses Electron's native autoUpdater (Squirrel.Mac) against
// update.electronjs.org. Squirrel.Mac relies on native OS networking, which
// avoids the c-ares DNS crash that electron-updater triggers on macOS.
function setupMacUpdater () {
  const feedURL = getFeedUrl()
  log.info('[auto-updater] feedURL', feedURL)

  // update.electronjs.org returns JSON (or HTTP 204 when up to date),
  // so Squirrel must be told serverType: 'json' or it fails to parse the response.
  nativeUpdater.setFeedURL({
    url: feedURL,
    serverType: 'json',
    headers: {
      'User-Agent': `peersky-browser/${app.getVersion()} (${process.platform}: ${process.arch})`
    }
  })

  nativeUpdater.on('checking-for-update', () => {
    log.info('[auto-updater] checking-for-update')
  })

  nativeUpdater.on('update-available', () => {
    log.info('[auto-updater] update-available; downloading...')
  })

  nativeUpdater.on('update-not-available', () => {
    log.info('[auto-updater] update-not-available')
  })

  nativeUpdater.on('download-progress', (progress) => {
    log.info(`[auto-updater] download ${progress.percent?.toFixed(1) ?? 0}%`)
  })

  nativeUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
    log.info('[auto-updater] update-downloaded:', releaseName || releaseNotes)
    if (promptRestart(releaseName || releaseNotes)) {
      nativeUpdater.quitAndInstall()
    }
  })

  nativeUpdater.on('error', (err) => {
    log.error('[auto-updater] error:', err?.message || err)
  })

  scheduleChecks(() => {
    // Native autoUpdater.checkForUpdates() returns void (not a Promise),
    // so guard with try/catch rather than .catch().
    try {
      nativeUpdater.checkForUpdates()
    } catch (err) {
      log.error('[auto-updater] checkForUpdates failed:', err?.message || err)
    }
  })
}

// Windows ships NSIS installers, which the native autoUpdater (Squirrel.Windows)
// cannot consume. electron-updater reads the GitHub publish config from the
// generated app-update.yml and handles NSIS download + install. electronUpdater
// .autoUpdater is a lazy getter, so the platform updater is only instantiated
// here on Windows and never on macOS (where it would risk the c-ares crash).
function setupWindowsUpdater () {
  const { autoUpdater } = electronUpdater
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    log.info('[auto-updater] checking-for-update')
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[auto-updater] update-available; downloading...', info?.version)
  })

  autoUpdater.on('update-not-available', () => {
    log.info('[auto-updater] update-not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    log.info(`[auto-updater] download ${progress?.percent?.toFixed(1) ?? 0}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[auto-updater] update-downloaded:', info?.version)
    if (promptRestart(info?.releaseName || info?.version)) {
      autoUpdater.quitAndInstall()
    }
  })

  autoUpdater.on('error', (err) => {
    log.error('[auto-updater] error:', err?.message || err)
  })

  scheduleChecks(() => {
    // electron-updater.checkForUpdates() returns a Promise, so guard with .catch().
    autoUpdater.checkForUpdates().catch((err) => {
      log.error('[auto-updater] checkForUpdates failed:', err?.message || err)
    })
  })
}

function setupAutoUpdater () {
  if (!app.isPackaged) {
    if (process.env.PEERSKY_TEST_UPDATE) {
      log.info('[auto-updater] Dev mode: PEERSKY_TEST_UPDATE set — simulating the update popup.')
      simulateUpdatePopupForDev()
      return
    }
    log.info('[auto-updater] Dev mode: auto-update checks run only in packaged ' +
      'builds (1h interval after a 10s delay). Set PEERSKY_TEST_UPDATE=1 to preview the popup.')
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

  if (process.platform === 'win32') {
    try {
      setupWindowsUpdater()
    } catch (err) {
      log.error('[auto-updater] Windows updater init failed:', err?.message || err)
    }
    return
  }

  setupMacUpdater()
}

export { setupAutoUpdater }
