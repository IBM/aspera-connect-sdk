export const MIN_SECURE_VERSION = '3.8.0';
export const DRIVE_API = 'aspera-drive';
export const FASP_API = 'fasp';
export const CURRENT_API = 'fasp';
export const SS_SESSION_LASTKNOWN_ID = 'aspera-last-known-session-id';
export const SS_APPSIDE_WAMPSESSN_LAUNCH_ATTEMPTED = 'aspera-appside-wampsessn-launch-attempted';

export const LS_CONTINUED_KEY = 'connect-version-continued';
export const LS_CONNECT_APP_ID = 'connect-app-id';
export const LS_LOG_KEY = 'aspera-log-level';
export const LS_CONNECT_DETECTED = 'aspera-last-detected';

export const MAX_POLLING_ERRORS = 3;

export const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
  DELETE: 'DELETE',
  REVERT: 'REVERT'
};

export const STATUS = {
  INITIALIZING: 'INITIALIZING',
  RETRYING: 'RETRYING',
  RUNNING: 'RUNNING',
  OUTDATED: 'OUTDATED',
  FAILED: 'FAILED',
  EXTENSION_INSTALL: 'EXTENSION_INSTALL'
};

export const EVENT = {
  ALL: 'all',
  TRANSFER: 'transfer',
  STATUS: 'status'
};

export const TRANSFER_STATUS = {
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  FAILED: 'failed',
  INITIATING: 'initiating',
  QUEUED: 'queued',
  REMOVED: 'removed',
  RUNNING: 'running',
  WILLRETRY: 'willretry'
};

export const DEFAULT_PORT = 43003;
export const LOCALHOST = 'https://local.connectme.us:';
export const MAX_PORT_SEARCH = 10;
export const VERSION_PREFIX = '/v6';
export const SESSION_LASTKNOWN_KEY = 'aspera-last-known-session-key';
export const SESSION_LASTKNOWN_PORT = 'aspera-last-known-port';

export const INSTALL_EVENT = {
  DOWNLOAD_CONNECT : "downloadconnect",
  REFRESH_PAGE : "refresh",
  IFRAME_REMOVED : "removeiframe",
  IFRAME_LOADED : "iframeloaded",
  TROUBLESHOOT : "troubleshoot",
  CONTINUE : "continue",
  RESIZE : "px",
  RETRY : "retry",
  EXTENSION_INSTALL : 'extension_install',
  DOWNLOAD_EXTENSION : 'download_extension'
};
