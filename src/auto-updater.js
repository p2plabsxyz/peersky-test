import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import log from 'electron-log';
import { dialog } from 'electron';

function setupAutoUpdater() {
  // Configure electron-log
  log.transports.file.level = 'info';
  log.transports.console.level = 'info';
  autoUpdater.logger = log;

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info);
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available:', info);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    log.info(`Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`);
  });

  autoUpdater.on('update-downloaded', () => {
    const response = dialog.showMessageBoxSync({
      type: 'info',
      buttons: ['Restart Now', 'Later'],
      title: 'Update Ready',
      message: 'A new version has been downloaded. Restart now to install it.'
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.on('error', (error) => {
    log.error('Auto-update error:', error);
  });

  // Initiate update check after 10 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 10000);
}

export { setupAutoUpdater };

