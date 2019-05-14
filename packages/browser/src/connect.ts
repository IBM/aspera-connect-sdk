import * as Utils from './utils';
import * as Logger from './logger';
import RequestHandler from './request/request';
import {
  HTTP_METHOD,
  STATUS,
  EVENT,
  TRANSFER_STATUS
} from './shared/constants';
import { minRequestedVersion, SESSION_ID } from './shared/sharedInternals';

/**
 * == API ==
 */

/** section: API
 * AW4
 *
 * The Aspera Web namespace.
 */

/** section: API
 * class AW4.Connect
 *
 * The [[AW4.Connect]] class contains all the Connect API methods.
 */

/**
 * new AW4.Connect([options])
 * - options (Object): Configuration parameters for the plug-in.
 *
 * Creates a new [[AW4.Connect]] object.
 *
 * ##### Options
 *
 * 1. `connectLaunchWaitTimeoutMs` (`Number`):
 *     How long to wait in milliseconds for Aspera Connect to launch, if we reach
 *     this timeout without a successful request to connect, we will go into FAILED
 *     status.
 *     `5000`.
 * 2. `id` (`String`):
 *     The DOM `id` of the plug-in object to be inserted. Default:
 *     `"aspera-web"`.
 * 3. `containerId` (`String`):
 *     The DOM `id` of an existing element to insert the plug-in element into
 *     (replacing its contents). If not specified, the plug-in is appended to
 *     the document body. Note that the plug-in must not be hidden in order to
 *     be loaded.
 * 4. `sdkLocation` (`String`):
 *     Optional. Specifies custom SDK location to check for Connect installers.
 *     It has to be in the following format:`//domain/path/to/connect/sdk`.
 *     The default location, if not specified is the unchanging Aspera location
 *     for the current SDK: `//d3gcli72yxqn2z.cloudfront.net/connect/v4`. If you
 *     are hosting your own SDK, and not using the Aspera one, then you must
 *     provide the location to your copy of the SDK. This points to the /v4/ folder
 *     of the provided SDK. This folder contains a number of items including JavaScript
 *     API and installer code, installers for all platforms, and documentation.
 *     The URL provided needs to be in the same level of security as the web page
 *     (HTTP/HTTPS), HTTPS preferred.
 * 5. `pollingTime` (`Number`):
 *     How often in milliseconds we want to get updates of the transfer's status
 *     Default: `2000`.
 * 6. `minVersion` (`String`):
 *     Minimum version of connect required by the web application in order to work.\
 *     Format:\
 *     `3.8.0`
 * 7. `dragDropEnabled` (`Boolean`):
 *     Enable drag and drop of files/folders into the browser
 *     Default: \
 *     `false`.
 * 8. `connectMethod` (`String`):
 *     Optional. Specify preferred implementation for Connect communication.
 *     Values:
 *     1. `http`
 *     2. `extension`
 *     Default for Connect 3.8 minVersion: `http`
 *     Default for Connect 3.9 minVersion: `extension`
 *
 * ##### Example
 *
 * The following JavaScript creates an [[AW4.Connect]] object to interface with
 * Aspera Connect on the client computer. This code should be executed on
 * document ready.
 *
 *     var asperaConnect = new AW4.Connect();
 *
 */
 
interface ConnectOptions {
  connectLaunchWaitTimeoutMs?: number;
  id?: string;
  containerId?: string;
  sdkLocation?: string;
  pollingTime?: number;
  minVersion?: string;
  dragDropEnabled?: boolean;
  authorizationKey?: string;
  connectMethod?: string;
  maxActivityOutstanding?: number;
}

interface IAsperaConnectSettings {
  app_id?: string;
  back_link?: string;
  request_id?: string;
}

interface ITransferSpec {
  direction: 'send' | 'receive';
  paths: any[];
  remote_host: string;
  authentication?: 'password' | 'token';
  cipher?: 'none' | 'aes-128';
  content_protection?: boolean;
  content_protection_passphrase?: string;
  cookie?: string;
  create_dir?: boolean;
  destination_root?: string;
  dgram_size?: number;
  fasp_port?: number;
  http_fallback?: boolean;
  http_fallback_port?: number;
  lock_min_rate?: boolean;
  lock_rate_policy?: boolean;
  lock_target_rate?: boolean;
  min_rate_kbps?: number;
  rate_policy?: 'fixed' | 'high' | 'fair' | 'low';
  remote_password?: string;
  remote_user?: string;
  resume?: 'none' | 'attributes' | 'sparse_checksum' | 'full_checksum';
  source_root?: string;
  ssh_port?: number;
  target_rate_cap_kbps?: number;
  target_rate_kbps?: number;
  token?: string;
}

interface ITransferSpecs {
  transfer_specs: [{
    transfer_spec: ITransferSpec,
    aspera_connect_settings: IAsperaConnectSettings
  }]
}

interface IEvtListener {
  (evt: string, data: any): void;
}

interface ICallbacks {
  success(response: any): any;
  error?(response: any): any;
}

// NOTE: Typescript classes only enforce private modifiers at compile time but not
//   at runtime. So converting Connect to class notation would make all private
//   variables/functions public at runtime.
function Connect (options: ConnectOptions) {
  if (Utils.isNullOrUndefinedOrEmpty(options)) {
    options = {};
  }

  let INITIALIZE_TIMEOUT = options.connectLaunchWaitTimeoutMs || 5000;
  let PLUGIN_ID = options.id || 'aspera-web';
  let PLUGIN_CONTAINER_ID = options.containerId || 'aspera-web-container';
  let SDK_LOCATION = Utils.getFullURI(options.sdkLocation) || '//d3gcli72yxqn2z.cloudfront.net/connect/v4';
  let APPLICATION_ID: any  = '';
  let AUTHORIZATION_KEY = options.authorizationKey || '';
  let POLLING_TIME = options.pollingTime || 2000;
  let MINIMUM_VERSION = options.minVersion || '';
  let CONNECT_METHOD = options.connectMethod || '';
  let DRAGDROP_ENABLED = options.dragDropEnabled || false;
  let MAX_ACTIVITY_OUTSTANDING = options.maxActivityOutstanding || 2;

  // Utils.CURRENT_API = Utils.FASP_API;
  // Utils.SDK_LOCATION = SDK_LOCATION;

  // Expose the requested version to the install banner
  if (options.minVersion) {
    // AW4.MIN_REQUESTED_VERSION = options.minVersion;
    minRequestedVersion.set(options.minVersion);
  }

  if (typeof(Storage) !== 'undefined') {
    let overrideMethod = Utils.getLocalStorage('aspera-connect-method');
    if (overrideMethod) {
      CONNECT_METHOD = overrideMethod;
    }
  }

  // TODO: Is this needed?
  // options.addStandardSettings = addStandardConnectSettings;

  let transferListeners: IEvtListener[] = [];
  let transferEventIntervalId = 0;
  let transferEventIterationToken: any = 0;
  let requestHandler: any = null;
  let statusListeners: IEvtListener[] = [];
  let connectStatus = STATUS.INITIALIZING;
  let objectId = Utils.nextObjectId();
  let outstandingActivityReqs = 0; // Keep track of polling requests to avoid overfilling the queue

  function addStandardConnectSettings (data: any) {
    if (AUTHORIZATION_KEY.length !== 0) {
      data.authorization_key = AUTHORIZATION_KEY;
    }
    if (Utils.isNullOrUndefinedOrEmpty(data.aspera_connect_settings)) {
      data.aspera_connect_settings = {};
    }
    data.aspera_connect_settings.app_id = APPLICATION_ID;
    return data;
  }

  function connectHttpRequest (method: string, path: string, data: any | null, sessionId: string, callbacks: ICallbacks | null) {
    if (requestHandler == null) {
      console.error('Connect#initSession must be called before invoking Connect API[' + path + '].');
      return null;
    }
    // Use our own local variable to avoid mutating user's object
    let localData: any = {};
    if (!Utils.isNullOrUndefinedOrEmpty(data)) {
      // 5-10 times faster than JSON.parse(JSON.stringify(data))
      for (let property in data) {
        if (data.hasOwnProperty(property)) {
          localData[property] = data[property];
        }
      }
    }
    // prepare data
    let dataStr = JSON.stringify(addStandardConnectSettings(localData));
    // start request
    requestHandler.start(method, path, dataStr, sessionId, callbacks);
    return null;
  }

  function driveHttpRequest (method: string, path: string, data: string | null, sessionId: string, callbacks: ICallbacks) {
    if (requestHandler == null) {
      return null;
    }
    // prepare data
    let dataStr = JSON.stringify(data);
    // start request
    requestHandler.start(method, path, dataStr, sessionId, callbacks);
    return null;
  }

  function getAllTransfersHelper (iterationToken: string, callbacks: ICallbacks) {
    // This is never supposed to happen
    if (Utils.isNullOrUndefinedOrEmpty(iterationToken)) {
      return null;
    }
    let data = { iteration_token: iterationToken };
    return connectHttpRequest(HTTP_METHOD.POST, '/connect/transfers/activity', data, SESSION_ID.value(), callbacks);
  }

  function notifyTransferListeners (response: any) {
    // First update the iterate token for future requests
    transferEventIterationToken = response.iteration_token;
    // Notify the listeners
    for (let i = 0; i < transferListeners.length; i++) {
      transferListeners[i](EVENT.TRANSFER, response);
    }
  }

  function pollTranfersHelperFunction () {
    // TODO: Need to make sure that all request implementations error on timeout
    if (outstandingActivityReqs >= MAX_ACTIVITY_OUTSTANDING) {
      Logger.debug('Skipping activity request. Reached maximum number of outstanding polling requests.');
      return;
    }
    outstandingActivityReqs++;
    getAllTransfersHelper(transferEventIterationToken, {
      success: function (response: any) {
        outstandingActivityReqs--;
        notifyTransferListeners(response);
      },
      error: function () {
        outstandingActivityReqs--;
      }
    });
  }

  function removeEventListenerHelper (listener: IEvtListener, listenerArray: IEvtListener[]) {
    let listenerFound = false;
    let index = listenerArray.indexOf(listener);
    while (index > -1) {
      listenerArray.splice(index, 1);
      listenerFound = true;
      index = listenerArray.indexOf(listener);
    }
    return listenerFound;
  }

  function isAppIdEntropyOk (appId: string) {
    let entropy = 0;
    let len = appId.length;
    let charFreq = Object.create(null);
    appId.split('').forEach(function (s) {
      if (charFreq[s]) {
        charFreq[s] += 1;
      } else {
        charFreq[s] = 1;
      }
    });
    for (let s in charFreq) {
      let percent = charFreq[s] / len;
      entropy -= percent * (Math.log(percent) / Math.log(2));
    }
    return entropy > 3.80;
  }

  ////////////////////////////////////////////////////////////////////////////
  // Manage Connect Status and high level logic
  ////////////////////////////////////////////////////////////////////////////

  function notifyStatusListeners (notifyStatus: any) {
    for (let i = 0; i < statusListeners.length; i++) {
      statusListeners[i](EVENT.STATUS, notifyStatus);
    }
  }

  function setConnectStatus (newStatus: string) {
    Logger.debug('[' + objectId + '] Connect status changing from[' + connectStatus + '] to[' + newStatus + ']');
    connectStatus = newStatus;
  }

  function manageConnectStatus (newStatus: number) {
    // Initialize options before calling RUNNING
    if (newStatus === RequestHandler.STATUS.RUNNING && DRAGDROP_ENABLED) {
      connectHttpRequest(HTTP_METHOD.GET, '/connect/file/initialize-drag-drop', null, SESSION_ID.value(), null);
    }
    if (newStatus === RequestHandler.STATUS.INITIALIZING) {
      setConnectStatus(STATUS.INITIALIZING);
    } else if (newStatus === RequestHandler.STATUS.RETRYING) {
      setConnectStatus(STATUS.RETRYING);
    } else if (newStatus === RequestHandler.STATUS.FAILED) {
      setConnectStatus(STATUS.FAILED);
    } else if (newStatus === RequestHandler.STATUS.EXTENSION_INSTALL) {
      setConnectStatus(STATUS.EXTENSION_INSTALL);
    } else if (newStatus === RequestHandler.STATUS.WAITING) {
      // No change
    } else if (newStatus === RequestHandler.STATUS.OUTDATED) {
      if (connectStatus !== STATUS.OUTDATED) {
        setConnectStatus(STATUS.OUTDATED);
      }
    } else {
      setConnectStatus(STATUS.RUNNING);
    }
    notifyStatusListeners(connectStatus);
  }

  this.connectHttpRequest = connectHttpRequest;
  this.driveHttpRequest = driveHttpRequest;
  this.isNullOrUndefinedOrEmpty = Utils.isNullOrUndefinedOrEmpty;

    ////////////////////////////////////////////////////////////////////////////
    // API Functions
    ////////////////////////////////////////////////////////////////////////////

  /**
   * AW4.Connect#addEventListener(type, listener) -> null | Error
   * - type (EVENT): The type of event to receive events for. See
   * below for the format.
   * - listener (Function): The function that will be called when the event
   * occurs.
   *
   * Subscribe for Aspera Web events. The first time the listener is called
   * it will receive an event for each of the transfers already displayed in
   * Connect, such that the listener will know the complete state of all transfers.
   *
   * ##### Format for `listener`
   *
   *      function(eventType, data) { ... }
   *
   * Event types ([[EVENT]]) and their associated `data`:
   *
   * 1. `TRANSFER` - [[AllTransfersInfo]]
   * 2. `STATUS` - [[STATUS]]
   *
   */
  this.addEventListener = function (type: string, listener: IEvtListener) {
    // Check the parameters
    if (typeof type !== typeof EVENT.ALL) {
      return Utils.createError(-1, 'Invalid EVENT parameter');
    } else if (typeof listener !== 'function') {
      return Utils.createError(-1, 'Invalid Listener parameter');
    }
    // Add the listener
    if (type === EVENT.TRANSFER || type === EVENT.ALL) {
      if (transferEventIntervalId === 0) {
        transferEventIntervalId = setInterval(pollTranfersHelperFunction, POLLING_TIME);
      }
      // Already set a function for polling the status, just add to the queue
      transferListeners.push(listener);
    }
    if (type === EVENT.STATUS || type === EVENT.ALL) {
      statusListeners.push(listener);
    }
    return null;
  };

  /**
   * AW4.Connect#authenticate(authSpec, callbacks) -> null | Error
   * - authSpec (Object): Authentication credentials
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Test authentication credentials against a transfer server.
   *
   * ##### Options for `authSpec`
   *
   * These are a subset of [[TransferSpec]].
   *
   * 1. `remote_host`
   * 2. `ssh_port`
   * 3. `remote_user`
   * 4. `remote_password`
   * 5. `token`
   *
   * ##### Object returned to success callback as parameter
   *
   *     {}
   */
  this.authenticate = function (authSpec: Partial<ITransferSpec>, callbacks: ICallbacks) {
    if (Utils.isNullOrUndefinedOrEmpty(authSpec)) {
      return Utils.createError(-1, 'Invalid authSpec parameter');
    }
    connectHttpRequest(HTTP_METHOD.POST, '/connect/info/authenticate', authSpec, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#getAllTransfers(callbacks[, iterationToken]) -> null
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   * - iterationToken (String): (*optional*) If specified, return only
   * transfers that have had activity since the last call.
   *
   * *This method is asynchronous.*
   *
   * Get statistics for all transfers.
   *
   * ##### Object returned to success callback as parameter
   *
   * See [[AllTransfersInfo]]
   *
   */
  this.getAllTransfers = function (callbacks: ICallbacks, iterationToken: string = '0') {
    // if (Utils.isNullOrUndefinedOrEmpty(iterationToken)) {
    //   iterationToken = '0';
    // }
    getAllTransfersHelper(iterationToken, callbacks);
    return null;
  };

  /**
   * AW4.Connect#getStatus() -> STATUS
   *
   * Get current status of Connect
   */
  this.getStatus = function () {
    return connectStatus;
  };

  /**
   * AW4.Connect#initSession([applicationId]) -> Object | Error
   *  - applicationId (String): (*optional*) An ID to represent this session.
   * Transfers initiated during this session will be associated with the ID.
   * To continue a previous session, use the same ID as before. Use a unique ID
   * in order to keep transfer information private from other websites. An ID
   * is automatically generated for you if not specified (default).
   *
   * Call this method after creating the [[AW4.Connect]] object. It is mandatory to call
   * this function before making use of any other function of the API. If called more than
   * once on the same instance, it will return an error
   *
   * ##### Return format
   *
   *      {
   *        "app_id" : "APPLICATION_ID"
   *      }
   */
  this.initSession = function (applicationId?: string) {
    if (Utils.isNullOrUndefinedOrEmpty(APPLICATION_ID)) {
      if (Utils.isNullOrUndefinedOrEmpty(applicationId)) {
        APPLICATION_ID = Utils.getLocalStorage(Utils.LS_CONNECT_APP_ID);
        if (Utils.isNullOrUndefinedOrEmpty(APPLICATION_ID)) {
          APPLICATION_ID = Utils.utoa(Utils.generateUuid());
          Utils.setLocalStorage(Utils.LS_CONNECT_APP_ID, APPLICATION_ID);
        }
      } else {
        APPLICATION_ID = applicationId;
      }
    } else {
      return Utils.createError(-1, 'Session was already initialized');
    }
    if (!isAppIdEntropyOk(APPLICATION_ID)) {
      Logger.warn('WARNING: app_id field entropy might be too low.');
    }
    // Initialize requests
    let error = this.start();
    if (error == null) {
      return { 'app_id' : APPLICATION_ID };
    }
    return error;
  };

  /**
   * AW4.Connect#modifyTransfer(transferId, options, callbacks) -> null
   * - transferId (String): The ID of the transfer to modify.
   * - options (Object): A subset of [[TransferSpec]]
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Change the speed of a running transfer.
   *
   * ##### `options`:
   *
   * See [[TransferSpec]] for definitions.
   *
   * 1. `rate_policy`
   * 2. `target_rate_kbps`
   * 3. `min_rate_kbps`
   * 4. `target_rate_cap_kbps`
   * 5. `lock_rate_policy`
   * 6. `lock_target_rate`
   * 7. `lock_min_rate`
   *
   * ##### Object returned to success callback as parameter
   *
   * See [[TransferSpec]]
   */
  this.modifyTransfer = function (transferId: string, options: Partial<ITransferSpec>, callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.POST, '/connect/transfers/modify/' + transferId, options, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#readAsArrayBuffer(options, callbacks) -> null | Error
   * - options (Object): Object with the options needed for reading the file as 64-bit encoded data.
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * ##### Options
   * 1. 'path' ('String'):
   *     Absolute path to the file we want to read the chunk from.
   *
   * ##### Object returned to success callback as parameter
   *
   *      {
   *        "type" : "image/pjpeg",
   *        "data" : "/9j/4AAQSkZ..."
   *      }
   */
  this.readAsArrayBuffer = function (options: { path: string }, callbacks: ICallbacks) {
    console.warn('AW4.Connect#readAsArrayBuffer will be deprecated in the future.');
    // let params = {};
    if (!options) {
      return Utils.createError(-1, 'Invalid options parameter');
    }
    connectHttpRequest(HTTP_METHOD.POST, '/connect/file/read-as-array-buffer/', options, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#readChunkAsArrayBuffer(options, callbacks) -> null | Error
   * - options (Object): Object with the options needed for reading a chunk
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * ##### Options
   * 1. 'path' ('String'):
   *     Absolute path to the file we want to read the chunk from.
   * 2. 'offset' ('Number'):
   *     Offset (in bytes) that we want to start reading the file.
   * 3. 'chunkSize' ('Number'):
   *     The size (in bytes) of the chunk we want.
   *
   * ##### Object returned to success callback as parameter
   *
   *      {
   *        "type" : "image/pjpeg",
   *        "data" : "/9j/4AAQSkZ..."
   *      }
   *
   */
  this.readChunkAsArrayBuffer = function (options: { path: string, offset: number, chunkSize: number }, callbacks: ICallbacks) {
    console.warn('AW4.Connect#readChunkAsArrayBuffer will be deprecated in the future.');
    if (!options.path || typeof options.offset === 'undefined' || typeof options.chunkSize === 'undefined') {
      return Utils.createError(-1, 'Invalid parameters');
    }
    connectHttpRequest(HTTP_METHOD.POST, '/connect/file/read-chunk-as-array-buffer/', options, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#removeEventListener([type][, listener]) -> Boolean
   * - type (EVENT): (*optional*) The type of event to stop receiving events for.
   * - listener (Function): (*optional*) The function used to subscribe in
   * [[AW4.Connect#addEventListener]].
   *
   * Unsubscribe from Aspera Web events. If `type` is not specified,
   * all versions of the `listener` with different types will be removed.
   * If `listener` is not specified, all listeners for the `type` will be
   * removed. If neither `type` nor `listener` are specified, all listeners
   * will be removed.
   *
   * ##### Return values
   *
   * 1. `true` : if we could find a listener for the parameters provided
   * 2. `false` : if we could not find a listener for the parameters provided
   */
  this.removeEventListener = function (type?: string, listener?: () => any) {
    let listenerFound = false;

    if (typeof type === 'undefined') {
      if (transferListeners.length > 0) {
        transferListeners = [];
        listenerFound = true;
      }
      if (statusListeners.length > 0) {
        statusListeners = [];
        listenerFound = true;
      }
    } else if (typeof type !== typeof EVENT.ALL) {
      // The parameter type is actually the listener
      // @ts-ignore
      listenerFound = listenerFound || removeEventListenerHelper(type, transferListeners);
      // @ts-ignore
      listenerFound = listenerFound || removeEventListenerHelper(type, statusListeners);
    } else if (typeof listener !== 'function') {
      // The user only provided the type
      // First the TRANSFER events
      if (type === EVENT.TRANSFER || type === EVENT.ALL) {
        if (transferListeners.length > 0) {
          transferListeners = [];
          listenerFound = true;
        }
      }
      // Then the STATUS events
      if (type === EVENT.STATUS || type === EVENT.ALL) {
        if (statusListeners.length > 0) {
          statusListeners = [];
          listenerFound = true;
        }
      }
    } else {
      // The user provided both arguments
      // First the TRANSFER events
      if (type === EVENT.TRANSFER || type === EVENT.ALL) {
        listenerFound = listenerFound || removeEventListenerHelper(listener, transferListeners);
      }
      // Then the STATUS events
      if (type === EVENT.STATUS || type === EVENT.ALL) {
        listenerFound = listenerFound || removeEventListenerHelper(listener, statusListeners);
      }
    }
    if (transferListeners.length === 0) {
      clearInterval(transferEventIntervalId);
      transferEventIntervalId = 0;
    }
    return listenerFound;
  };

  /**
   * AW4.Connect#removeTransfer(transferId, callbacks) -> null
   * - transferId (String): The ID (`uuid`) of the transfer to delete.
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Remove the transfer - terminating it if necessary - from Connect.
   *
   * ##### Object returned to success callback as parameter
   *
   * See [[TransferSpec]]
   */
  this.removeTransfer = function (transferId: string, callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.POST, '/connect/transfers/remove/' + transferId, null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#resumeTransfer(transferId, options, callbacks) -> null
   * - transferId (String): The ID (`uuid`) of the transfer to resume.
   * - options (Object): A subset of [[TransferSpec]]
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Resume a transfer that was stopped.
   *
   * ##### `options`:
   *
   * See [[TransferSpec]] for definitions.
   *
   * 1. `token`
   * 2. `cookie`
   * 3. `authentication`
   * 4. `remote_user`
   * 5. `remote_password`
   * 6. `content_protection_passphrase`
   *
   * ##### Object returned to success callback as parameter
   *
   * See [[TransferSpec]]
   */
  this.resumeTransfer = function (transferId: string, options: Partial<ITransferSpec>, callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.POST, '/connect/transfers/resume/' + transferId, options, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#setDragDropTargets(cssSelector, options, listener) -> null | Error
   * - cssSelector (String): CSS selector for drop targets
   * - options (Object): (*optional*) Drag and drop options for these targets
   * - listener (Function): Function to be called when each of the event occurs
   *
   * *This method is asynchronous.*
   *
   * Sets drag and drop options for the element given in the cssSelector. Please note that
   * dragDropEnabled option must have been set to `true` when instantiating Aspera Connect
   * object.
   *
   * ##### `options`:
   *
   * 1. `dragEnter` (`Boolean`): `true` if drag enter event should trigger the listener. Default: `false`.
   * 2. `dragOver` (`Boolean`): `true` if drag over event should trigger the listener. Default: `false`.
   * 3. `dragLeave` (`Boolean`): `true` if drag leave event should trigger the listener. Default: `false`.
   * 4. `drop` (`Boolean`): `true` if drop event should trigger the listener. Default: `true`.
   *
   *
   * ##### Fields of the object returned to the listener
   *
   * 1. `event` (`Object`): DOM Event object as implemented by the browser.
   * 2. `files` (`Object`): See [[dataTransfer]]. This is only valid on `drop` events.
   *
   */
  interface IDragDropOptions {
    dragEnter?: boolean;
    dragOver?: boolean;
    dragLeave?: boolean;
    drop?: boolean;
  }

  this.setDragDropTargets = function (cssSelector: string, options: IDragDropOptions, listener: (evt: any) => any) {
    if (!DRAGDROP_ENABLED) {
      return Utils.createError(-1, 'Drop is not enabled in the initialization ' +
        'options, please instantiate Connect again with the dragDropEnabled option set to true.');
    }
    if (typeof listener !== 'function') {
      return Utils.createError(-1, 'You must provide a valid listener');
    }
    if (Utils.isNullOrUndefinedOrEmpty(options)) {
      return Utils.createError(-1, 'You must provide a valid options object');
    }
    let elements = document.querySelectorAll(cssSelector);
    if (elements.length === 0) {
      return Utils.createError(-1, 'No valid elements for the selector given');
    }
    let dragListener = function (evt: any) {
      evt.stopPropagation();
      evt.preventDefault();
      listener({ event: evt });
    };
    // Needed for the Drop event to be called
    let dragOverListener = function (evt: any) {
      evt.stopPropagation();
      evt.preventDefault();
      if (options.dragOver === true) {
        listener({ event: evt });
      }
    };
    let dropListener = function (evt: any) {
      evt.stopPropagation();
      evt.preventDefault();
      // Prepare request and create a valid JSON object to be serialized
      let filesDropped = evt.dataTransfer.files;
      let data: any = {};
      data.dataTransfer = {};
      data.dataTransfer.files = [];
      for (let i = 0; i < filesDropped.length; i++) {
        let fileObject = {
          'lastModifiedDate' : filesDropped[i].lastModifiedDate,
          'name'             : filesDropped[i].name,
          'size'             : filesDropped[i].size,
          'type'             : filesDropped[i].type
        };
        data.dataTransfer.files.push(fileObject);
      }
      // Drop helper
      let dropHelper = function (response: any) {
        listener({ event: evt, files: response });
      };
      connectHttpRequest(HTTP_METHOD.POST, '/connect/file/dropped-files', data, SESSION_ID.value(), { success: dropHelper });
    };
    for (let i = 0; i < elements.length; i++) {
      // Independent from our implementation
      if (options.dragEnter === true) {
        elements[i].addEventListener('dragenter', dragListener);
      }
      if (options.dragLeave === true) {
        elements[i].addEventListener('dragleave', dragListener);
      }
      if (options.dragOver === true || options.drop !== false) {
        elements[i].addEventListener('dragover', dragOverListener);
      }
      if (options.drop !== false) {
        elements[i].addEventListener('drop', dropListener);
      }
    }
    return null;
  };

  /**
   * AW4.Connect#showAbout(callbacks) -> null
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Displays the Aspera Connect "About" window.
   *
   * ##### Object returned to success callback as parameter
   *
   *     {}
   */
  this.showAbout = function (callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.GET, '/connect/windows/about', null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#showDirectory(transferId, callbacks) -> null
   * - transferId (String): The ID (`uuid`) of the transfer to show files for.
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Open the destination directory of the transfer, using the system file
   * browser.
   *
   * ##### Object returned to success callback as parameter
   *
   *     {}
   */
  this.showDirectory = function (transferId: string, callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.GET, '/connect/windows/finder/' + transferId, null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#showPreferences(callbacks) -> null
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Displays the Aspera Connect "Preferences" window.
   *
   * ##### Object returned to success callback as parameter
   *
   *     {}
   */
  this.showPreferences = function (callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.GET, '/connect/windows/preferences', null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#showSaveFileDialog(callbacks[, options]) -> null
   * - callbacks (Callbacks): On success, returns the selected file path.
   * Returns `null` if the user cancels the dialog.
   * - options (Object): (*optional*) File chooser options
   *
   * *This method is asynchronous.*
   *
   * Displays a file chooser dialog for the user to pick a "save-to" path.
   *
   * ##### `options`:
   *
   * 1. `allowedFileTypes` ([[FileFilters]]): Filter the files displayed by file
   * extension.
   * 2. `suggestedName` (`String`): The file name to pre-fill the dialog with.
   * 3. `title` (`String`): The name of the dialog window.
   *
   * ##### Object returned to success callback as parameter
   *
   * See [[dataTransfer]]. If user canceled the dialog, it will return an empty object
   */
  interface ISaveFileDialogOptions {
    allowedFileTypes?: any;
    suggestedName?: string;
    title?: string;
  }
  this.showSaveFileDialog = function (callbacks: ICallbacks, options?: ISaveFileDialogOptions) {
    // Prepare the options object, use our own local variable to avoid mutating user's object
    let localOptions: any = {};
    if (Utils.isNullOrUndefinedOrEmpty(options)) {
      options = {};
    }
    localOptions.title = options!.title || '';
    localOptions.suggestedName = options!.suggestedName || '';
    localOptions.allowedFileTypes = options!.allowedFileTypes || '';
    connectHttpRequest(HTTP_METHOD.POST, '/connect/windows/select-save-file-dialog/', localOptions, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#showSelectFileDialog(callbacks[, options]) -> null
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   * - options (Object): (*optional*) File chooser options
   *
   * *This method is asynchronous.*
   *
   * Displays a file browser dialog for the user to select files. The select file
   * dialog call(s) may be separated in time from the later startTransfer(s) call,
   * but they must occur in the same Connect session.
   *
   * ##### `options`:
   *
   * 1. `allowedFileTypes` ([[FileFilters]]): Filter the files displayed by file
   * extension.
   * 2. `allowMultipleSelection` (`Boolean`): Allow the selection of multiple
   * files. Default: `true`.
   * 3. `title` (`String`): The name of the dialog window.
   *
   * ##### Object returned to success callback as parameter
   *
   * See [[dataTransfer]]. If user canceled the dialog, it will return an empty object
   */
  interface ISelectFileDialog {
    allowedFileTypes?: any;
    allowMultipleSelection?: boolean;
    suggestedName?: string;
    title?: string;
  }
  this.showSelectFileDialog = function (callbacks: ICallbacks, options: ISelectFileDialog) {
    // Prepare the options object, use our own local variable to avoid mutating user's object
    let localOptions: any = {};
    if (Utils.isNullOrUndefinedOrEmpty(options)) {
      options = {};
    }
    localOptions.title = options.title || '';
    localOptions.suggestedName = options!.suggestedName || '';
    localOptions.allowMultipleSelection = Utils.isNullOrUndefinedOrEmpty(options.allowMultipleSelection) || options.allowMultipleSelection;
    localOptions.allowedFileTypes = options!.allowedFileTypes || '';
    connectHttpRequest(HTTP_METHOD.POST, '/connect/windows/select-open-file-dialog/', localOptions, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#showSelectFolderDialog(callbacks[, options]) -> null
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   * - options (Object): (*optional*) File chooser options
   *
   * *This method is asynchronous.*
   *
   * Displays a file browser dialog for the user to select directories. The select
   * folder dialog call(s) may be separated in time from the later startTransfer(s)
   * call, but they must occur in the same Connect session.
   *
   * ##### `options`:
   *
   * 1. `allowMultipleSelection` (`Boolean`): Allow the selection of multiple
   * folders. Default: `true`.
   * 2. `title` (`String`): The name of the dialog window.
   *
   * ##### Object returned to success callback as parameter
   *
   * See [[dataTransfer]]. If user canceled the dialog, it will return an empty object
   */
  interface ISelectFolderDialog {
    allowMultipleSelection?: boolean;
    title?: string;
  }
  this.showSelectFolderDialog = function (callbacks: ICallbacks, options: ISelectFolderDialog) {
    // Prepare the options object, use our own local variable to avoid mutating user's object
    let localOptions: any = {};
    if (Utils.isNullOrUndefinedOrEmpty(options)) {
      options = {};
    }
    localOptions.title = options.title || '';
    localOptions.allowMultipleSelection = Utils.isNullOrUndefinedOrEmpty(options.allowMultipleSelection) || options.allowMultipleSelection;
    connectHttpRequest(HTTP_METHOD.POST, '/connect/windows/select-open-folder-dialog/', localOptions, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#showTransferManager(callbacks) -> null
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Displays the Aspera Connect "Transfer Manager" window.
   *
   * ##### Object returned to success callback as parameter
   *
   *     {}
   */
  this.showTransferManager = function (callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.GET, '/connect/windows/transfer-manager', null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#showTransferMonitor(transferId, callbacks) -> null
   * - transferId (String): The ID (`uuid`) of the corresponding transfer.
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Displays the Aspera Connect "Transfer Monitor" window for the transfer.
   *
   * ##### Object returned to success callback as parameter
   *
   *     {}
   */
  this.showTransferMonitor = function (transferId: string, callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.GET, '/connect/windows/transfer-monitor/' + transferId, null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#start() -> null | error
   *
   * It will start looking for Connect. Please note that this is called when calling AW4.Connect#initSession
   * and it should only be used after a call to AW4.Connect#stop
   */
  this.start = function () {
    if (APPLICATION_ID === '') {
      return Utils.createError(-1, 'Please call initSession first');
    }
    requestHandler = new RequestHandler();
    // Add status listener to connect
    requestHandler.addStatusListener(manageConnectStatus);
    // Initialize request
    let options = {
      pluginId: PLUGIN_ID,
      containerId: PLUGIN_CONTAINER_ID,
      initializeTimeout: INITIALIZE_TIMEOUT,
      sdkLocation: SDK_LOCATION,
      connectMethod: CONNECT_METHOD,
      minVersion: MINIMUM_VERSION
    };
    return requestHandler.init(options);
  };

  /**
   * AW4.Connect#startTransfer(transferSpec, connectSpecs, callbacks) -> Object | Error
   * - transferSpec (TransferSpec): Transfer parameters
   * - asperaConnectSettings (ConnectSpec): Aspera Connect options
   * - callbacks (Callbacks): `success` and `error` functions to
   * receive results. This call is successful if Connect is able to start the
   * transfer. Note that an error could still occur after the transfer starts,
   * e.g. if authentication fails. Use [[AW4.Connect#addEventListener]] to
   * receive notification about errors that occur during a transfer session.
   * This call fails if validation fails or the user rejects the transfer.
   *
   * *This method is asynchronous.*
   *
   * Initiates a single transfer. Call [[AW4.Connect#getAllTransfers]] to get transfer
   * statistics, or register an event listener through [[AW4.Connect#addEventListener]].
   *
   * ##### Return format
   *
   * The `request_id`, which is returned immediately, may be for matching
   * this transfer with its events.
   *
   *      {
   *        "request_id" : "bb1b2e2f-3002-4913-a7b3-f7aef4e79132"
   *      }
   */
  this.startTransfer = function (transferSpec: ITransferSpec, asperaConnectSettings: IAsperaConnectSettings, callbacks: ICallbacks) {
    if (Utils.isNullOrUndefinedOrEmpty(transferSpec)) {
      return Utils.createError(-1, 'Invalid transferSpec parameter');
    }

    let aspera_connect_settings = asperaConnectSettings || {};

    let transferSpecs: ITransferSpecs = {
      transfer_specs : [{
        transfer_spec : transferSpec,
        aspera_connect_settings : aspera_connect_settings
      }]
    };

    return this.startTransfers(transferSpecs, callbacks);
  };

  /**
   * AW4.Connect#startTransfers(transferSpecs, callbacks) -> Object | Error
   * - transferSpecs (Object): See below
   * - callbacks (Callbacks): `success` and `error` functions to
   * receive results. This call is successful if Connect is able to start the
   * transfer. Note that an error could still occur after the transfer starts,
   * e.g. if authentication fails. Use [[AW4.Connect#addEventListener]] to
   * receive notification about errors that occur during a transfer session.
   * This call fails if validation fails or the user rejects the transfer.
   *
   * *This method is asynchronous.*
   *
   * Initiates one or more transfers (_currently only the first `transfer_spec`
   * is used_). Call [[AW4.Connect#getAllTransfers]] to get transfer
   * statistics, or register an event listener through [[AW4.Connect#addEventListener]].
   *
   * Use this method when generating transfer specs using Aspera Node.
   *
   * ##### Return format
   *
   * The `request_id`, which is returned immediately, may be for matching
   * this start request with transfer events.
   *
   *      {
   *        "request_id" : "bb1b2e2f-3002-4913-a7b3-f7aef4e79132"
   *      }
   *
   * ##### Format for `transferSpecs`
   *
   * See [[TransferSpec]] and [[ConnectSpec]] for definitions.
   *
   *      {
   *        transfer_specs : [
   *          {
   *            transfer_spec : TransferSpec,
   *            aspera_connect_settings : ConnectSpec
   *          },
   *          {
   *            transfer_spec : TransferSpec,
   *            aspera_connect_settings : ConnectSpec
   *          },
   *          ...
   *        ]
   *      }
   */
  this.startTransfers = function (transferSpecs: ITransferSpecs, callbacks: ICallbacks) {
    if (Utils.isNullOrUndefinedOrEmpty(transferSpecs)) {
      return Utils.createError(-1, 'Invalid transferSpecs parameter');
    }
    let i;
    let requestId;
    let transferSpec;

    requestId = Utils.generateUuid();

    for (i = 0; i < transferSpecs.transfer_specs.length; i++) {
      transferSpec = transferSpecs.transfer_specs[i];
      addStandardConnectSettings(transferSpec);
      transferSpec.aspera_connect_settings.request_id = requestId;
      if (Utils.isNullOrUndefinedOrEmpty(transferSpec.aspera_connect_settings.back_link)) {
        transferSpec.aspera_connect_settings.back_link = window.location.href;
      }
    }
    connectHttpRequest(HTTP_METHOD.POST, '/connect/transfers/start', transferSpecs, SESSION_ID.value(), callbacks);
    return { request_id : requestId };
  };

  /**
   * AW4.Connect#stop() -> null
   *
   * Stop all requests from AW4.Connect to restart activity, please
   * create a new AW4.Connect object or call AW4.Connect#start
   */
  this.stop = function () {
    return requestHandler.stopRequests();
  };

  /**
   * AW4.Connect#stopTransfer(transferId, callbacks) -> null
   * - transferId (String): The ID (`uuid`) of the transfer to stop.
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * *This method is asynchronous.*
   *
   * Terminate the transfer. Use [[AW4.Connect#resumeTransfer]] to resume.
   */
  this.stopTransfer = function (transferId: string, callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.POST, '/connect/transfers/stop/' + transferId, null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#version(callbacks) -> null
   * - callbacks (Callbacks): `success` and `error` functions to receive
   * results.
   *
   * Get the Aspera Connect version.
   *
   * *This method is asynchronous.*
   *
   * ##### Object returned to success callback as parameter
   *
   *     {
   *       version : "3.6.0.8456"
   *     }
   */
  this.version = function (callbacks: ICallbacks) {
    if (Utils.isNullOrUndefinedOrEmpty(callbacks)) {
      return null;
    }
    connectHttpRequest(HTTP_METHOD.GET, '/connect/info/version', null, SESSION_ID.value(), callbacks);
    return null;
  };

  /**
   * AW4.Connect#invalidUri(callbacks) -> null
   *
   * For test only:
   *  A request with an invalid uri should result in a response of "404 - not found".
   */
  this.invalidUri = function (callbacks: ICallbacks) {
    connectHttpRequest(HTTP_METHOD.GET, '/invalid/uri', null,
      SESSION_ID.value(), callbacks);
    return null;
  };
};

Connect.EVENT = EVENT;
Connect.HTTP_METHOD = HTTP_METHOD;
Connect.STATUS = STATUS;
Connect.TRANSFER_STATUS = TRANSFER_STATUS;

// Object.assign(
//   Connect,
//   { HTTP_METHOD, STATUS, EVENT, TRANSFER_STATUS }
// );

export {
  Connect
}

// export default Connect;

// AW4.Connect

/**
 * == Objects ==
 *
 * Specifications for common objects used as arguments or result data.
 */

/** section: Objects
 * class Callbacks
 *
 * This object can be passed to an asynchronous API call to get the
 * results of the call.
 *
 * ##### Format
 *
 *     {
 *       success: function(Object) { ... },
 *       error: function(Error) { ... }
 *     }
 *
 * The argument passed to the `success` function depends on the original method
 * invoked. The argument to the `error` function is an [[Error]] object.
 *
 * If an Error is thrown during a callback, it is logged to window.console
 * (if supported by the browser).
 */

/** section: Objects
 * class Error
 *
 * This object is returned if an error occurs. It contains an error code
 * and a message.
 *
 * *Note that this is not related to the JavaScript `Error`
 * object, but is used only to document the format of errors returned by this
 * API.*
 *
 * ##### Format
 *
 *     {
 *       "error": {
 *         "code": Number,
 *         "internal_message": String,
 *         "user_message": String
 *       }
 *     }
 */

 /** section: Objects
  * class AllTransfersInfo
  *
  * The data format for statistics for all the existing transfers.
  *
  * See [[TransferInfo]].
  *
  * ##### Example
  *
  *     {
  *       "iteration_token": 28,
  *       "result_count": 3,
  *       "transfers": [
  *         TransferInfo,
  *         TransferInfo,
  *         TransferInfo
  *       ]
  *     }
  */

/**
 * AllTransfersInfo.iteration_token -> Number
 *
 * A marker that represents the moment in time
 * that the transfer status was retrieved. If it is passed as an argument to a
 * getAllTransfers call, the result set will only contain transfers that
 * have had activity since the previous call. Note that this token
 * persists, such that it is still valid if the user restarts Connect.
 *
 * Default: `0`
 */

/**
 * AllTransfersInfo.result_count -> Number
 *
 * The number of [[TransferInfo]] objects that [[AllTransfersInfo.transfers]] array contains.
 *
 * Default: `0`
 */

/**
 * AllTransfersInfo.transfers -> Array
 *
 * An array that contains [[TransferInfo]] objects.
 *
 * Default: `[]`
 */

/** section: Objects
 * class AsperaConnectSettings
 *
 * The data format for the connect web app parameters
 *
 * ##### Example
 *
 *     {
 *       "app_id": "TUyMGQyNDYtM2M1NS00YWRkLTg0MTMtOWQ2OTkxMjk5NGM4",
 *       "back_link": "http://demo.asperasoft.com",
 *       "request_id": "36d3c2a4-1856-47cf-9865-f8e3a8b47822"
 *     }
 */

/**
 * AsperaConnectSettings.app_id -> String
 *
 * A secure, random identifier for all transfers associated with this webapp.
 * Do not hardcode this id. Do not use the same id for different users.
 * Do not including the host name, product name in the id.
 * Do not use monotonically increasing ids.
 * If you do not provide one, a random id will be generated for you and persisted in localStorage.
 */

/**
 * AsperaConnectSettings.back_link -> String
 *
 * Link to the webapp.
 */

/**
 * AsperaConnectSettings.request_id -> String
 *
 * Universally Unique IDentifier for the webapp.
 */

/** section: Objects
 * class TransferInfo
 *
 * The data format for statistics for one transfer session.
 *
 * See [[TransferSpec]] and [[AsperaConnectSettings]] for definitions.
 *
 * ##### Example
 *
 *     {
 *       "add_time": "2012-10-05T17:53:16",
 *       "aspera_connect_settings": AsperaConnectSettings,
 *       "bytes_expected": 102400,
 *       "bytes_written": 11616,
 *       "calculated_rate_kbps": 34,
 *       "current_file": "/temp/tinyfile0001",
 *       "elapsed_usec": 3000000,
 *       "end_time": "",
 *       "modify_time": "2012-10-05T17:53:18",
 *       "percentage": 0.113438,
 *       "previous_status": "initiating",
 *       "remaining_usec": 21000000,
 *       "start_time": "2012-10-05T17:53:16",
 *       "status": "running",
 *       "title": "tinyfile0001",
 *       "transfer_iteration_token": 18,
 *       "transfer_spec": TransferSpec,
 *       "transport": "fasp",
 *       "uuid": "add433a8-c99b-4e3a-8fc0-4c7a24284ada",
 *       "files": [
 *          {
 *            "bytes_expected": 10485760,
 *            "bytes_written": 1523456,
 *            "fasp_file_id": "3c40b511-5b2dfebb-a2e63483-9b58cb45-9cd9abff",
 *            "file": "/Users/aspera/Downloads/connect_downloads/10MB.3"
 *          }, {
 *            "bytes_expected": 10485760,
 *            "bytes_written": 10485760,
 *            "fasp_file_id": "d5b7deea-2d5878f4-222661f6-170ce0f2-68880a6c",
 *            "file": "/Users/aspera/Downloads/connect_downloads/10MB.2"
 *          }
 *       ]
 *     }
 */

/**
 * TransferInfo.add_time -> String
 *
 * The time when the transfer was added (according to the system's clock).
 */

/**
 * TransferInfo.aspera_connect_settings -> AsperaConnectSettings
 */

/**
 * TransferInfo.bytes_expected -> Number
 *
 * The number of bytes that are still remaining to be written.
 */

/**
 * TransferInfo.bytes_written -> Number
 *
 * The number of bytes that have already been written to disk.
 */

/**
 * TransferInfo.calculated_rate_kbps -> Number
 *
 * The current rate of the transfer.
 */

/**
 * TransferInfo.current_file -> String
 *
 * The full path of the current file.
 */

/**
 * TransferInfo.elapsed_usec -> Number
 *
 * The duration of the transfer since it started transferring in microseconds.
 *
 * Default: `0`
 */

/**
 * TransferInfo.end_time -> String
 *
 * The time when the transfer was completed.
 *
 * Default: `""`
 */

/**
 * TransferInfo.modify_time -> String
 *
 * The last time the transfer was modified.
 *
 * Default: `""`
 */

/**
 * TransferInfo.percentage -> Number
 *
 * The progress of the transfer over 1.
 *
 * Default: `0`
 */

/**
 * TransferInfo.previous_status -> String
 *
 * The previous status of the transfer. See [[TransferInfo.status]]
 */

/**
 * TransferInfo.remaining_usec -> Number
 *
 * The ETA of the transfer in microseconds.
 *
 * Default: `0`
 */

/**
 * TransferInfo.start_time -> String
 *
 * The time when the transfer moved to initiating status.
 */

/**
 * TransferInfo.status -> String
 *
 * The status of the transfer.
 *
 * See [[TRANSFER_STATUS]]
 *
 */

/**
 * TransferInfo.title -> String
 *
 * The name of the file.
 */

/**
 * TransferInfo.transfer_iteration_token -> Number
 *
 * A marker that represents the moment in time that the transfer status was
 * checked.
 */

/**
 * TransferInfo.transfer_spec -> TransferSpec
 */

/**
 * TransferInfo.transport -> String
 *
 * Values:
 *
 * 1. `"fasp"` (default)
 * 2. `"http"` - Set when a fasp transfer could not be performed and http fallback was used
 */

/**
 * TransferInfo.uuid -> String
 *
 * The Universally Unique IDentifier for the transfer, so that it can be
 * differenced from any other.
 */

/**
 * TransferInfo.files -> Array
 *
 * A list of the files that have been active on this transfer session, with
 * information about their ID, full path, and size and transferred info. Please
 * note that files that haven't been active yet on this session, won't be
 * reported (and you can assume bytes_written is 0)
 *
 * ##### Files format
 *
 *     [
 *       {
 *         "bytes_expected": 10485760,
 *         "bytes_written": 1523456,
 *         "fasp_file_id": "3c40b511-5b2dfebb-a2e63483-9b58cb45-9cd9abff",
 *         "file": "/Users/aspera/Downloads/connect_downloads/10MB.3"
 *       }, {
 *         "bytes_expected": 10485760,
 *         "bytes_written": 10485760,
 *         "fasp_file_id": "d5b7deea-2d5878f4-222661f6-170ce0f2-68880a6c",
 *         "file": "/Users/aspera/Downloads/connect_downloads/10MB.2"
 *       }
 *     ]
 */

/** section: Objects
 * class TransferSpec
 *
 * The parameters for starting a transfer.
 *
 * ##### Minimal Example
 *
 *     {
 *       "paths": [
 *         {
 *           "source": "/foo/1"
 *         }
 *       ],
 *       "remote_host": "10.0.203.80",
 *       "remote_user": "aspera",
 *       "direction": "send"
 *     }
 *
 * ##### Download Example
 *
 *     {
 *       "paths": [
 *         {
 *           "source": "tinyfile0001"
 *         }, {
 *           "source": "tinyfile0002"
 *         }
 *       ],
 *       "remote_host": "demo.asperasoft.com",
 *       "remote_user": "asperaweb",
 *       "authentication": "password",
 *       "remote_password": "**********",
 *       "fasp_port": 33001,
 *       "ssh_port": 33001,
 *       "http_fallback": true,
 *       "http_fallback_port": 443,
 *       "direction": "receive",
 *       "create_dir": false,
 *       "source_root": "aspera-test-dir-tiny",
 *       "destination_root": "/temp",
 *       "rate_policy": "high",
 *       "target_rate_kbps": 1000,
 *       "min_rate_kbps": 100,
 *       "lock_rate_policy": false,
 *       "target_rate_cap_kbps": 2000,
 *       "lock_target_rate": false,
 *       "lock_min_rate": false,
 *       "resume": "sparse_checksum",
 *       "cipher": "aes-128",
 *       "cookie": "foobarbazqux",
 *       "dgram_size": 1492,
 *       "preserve_times": true,
 *       "tags": {
 *         "your_company": {
 *           "key": "value"
 *         }
 *       }
 *     }
 */

/** section: Objects
 * class dataTransfer
 *
 * This object holds the data of the files that have been selected by the user. It
 * may hold one or more data items
 *
 * ##### Format  *
 *     {
 *       "dataTransfer" : {
 *         "files": [
 *           {
 *             "lastModifiedDate": "Wed Sep 24 12:22:02 2014",
 *             "name": "/Users/aspera/Desktop/foo.txt",
 *             "size": 386,
 *             "type": "text/plain"
 *           },
 *           {
 *             "lastModifiedDate": "Mon Sep 22 18:01:02 2014",
 *             "name": "/Users/aspera/Desktop/foo.rb",
 *             "size": 609,
 *             "type": "text/x-ruby-script"
 *           }
 *         ]
 *       }
 *     }
 *
 */

/**
 * TransferSpec.authentication -> String
 *
 * *optional*
 *
 * The type of authentication to use.
 *
 * Values:
 *
 * 1. `"password"` (default)
 * 2. `"token"`
 */

/**
 * TransferSpec.cipher -> String
 *
 * *optional*
 *
 * The algorithm used to encrypt data sent during a transfer. Use this option
 * when transmitting sensitive data. Increases CPU utilization.
 *
 * Values:
 *
 * 1. `"none"`
 * 2. `"aes-128"` (default)
 */

/**
 * TransferSpec.content_protection -> String
 *
 * *optional*
 *
 * Enable content protection (encryption-at-rest), which keeps files encrypted
 * on the server. Encrypted files have the extension ".aspera-env".
 *
 * Values:
 *
 * 1. `"encrypt"`: Encrypt uploaded files. If `content_protection_passphrase`
 * is not specified, Connect will prompt for the passphrase.
 * 2. `"decrypt"`: Decrypt downloaded files. If `content_protection_passphrase`
 * is not specified, Connect will prompt for the passphrase.
 *
 * Default: disabled
 */

/**
 * TransferSpec.content_protection_passphrase -> String
 *
 * *optional*
 *
 * A passphrase to use to encrypt or decrypt files when using
 * `content_protection`.
 *
 * Default: none
 */

/**
 * TransferSpec.cookie -> String
 *
 * *optional*
 *
 * Data to associate with the transfer. The cookie is reported to both client-
 * and server-side applications monitoring fasp™ transfers. It is often used
 * by applications to identify associated transfers.
 *
 * Default: none
 */

/**
 * TransferSpec.create_dir -> Boolean
 *
 * *optional*
 *
 * Creates the destination directory if it does not already exist. When
 * enabling this option, the destination path is assumed to be a directory
 * path.
 *
 * Values:
 *
 * 1. `false` (default)
 * 2. `true`
 */

/**
 * TransferSpec.destination_root -> String
 *
 * *optional*
 *
 * The transfer destination file path. If destinations are specified in
 * `paths`, this value is prepended to each destination.
 *
 * Note that download destination paths are relative to the user's Connect
 * download directory setting unless `ConnectSpec.use_absolute_destination_path`
 * is enabled.
 *
 * Default: `"/"`
 */

/**
 * TransferSpec.dgram_size -> Number
 *
 * *optional*
 *
 * The IP datagram size for fasp™ to use. If not specified, fasp™ will
 * automatically detect and use the path MTU as the datagram size.
 * Use this option only to satisfy networks with strict MTU requirements.
 *
 * Default: auto-detect
 */

/**
 * TransferSpec.preserve_times -> Boolean
 *
 * *optional*
 *
 * When set to `true`, file timestamps are preserved during the transfer.
 *
 * Default: none
 */

/**
 * TransferSpec.direction -> String
 *
 * *required*
 *
 * Whether to perform an upload or a download.
 *
 * Values:
 *
 * 1. `"send"` (upload)
 * 2. `"receive"` (download)
 */

/**
 * TransferSpec.fasp_port -> Number
 *
 * *optional*
 *
 * The UDP port for fasp™ to use. The default value is satisfactory for most
 * situations. However, it can be changed to satisfy firewall requirements.
 *
 * Default: `33001`
 */

/**
 * TransferSpec.http_fallback -> Boolean
 *
 * *optional*
 *
 * Attempts to perform an HTTP transfer if a fasp™ transfer cannot be
 * performed.
 *
 * Values:
 *
 * 1. `false` (default)
 * 2. `true`
 */

/**
 * TransferSpec.http_fallback_port -> Number
 *
 * *optional*
 *
 * The port where the Aspera HTTP server is servicing HTTP transfers.
 * Defaults to port 443 if a `cipher` is enabled, or port 80 otherwise.
 *
 * Default: `80` or `443` (HTTPS)
 */

/**
 * TransferSpec.lock_min_rate -> Boolean
 *
 * *optional*
 *
 * Prevents the user from changing the minimum rate during a transfer.
 *
 * Values:
 *
 * 1. `false` (default)
 * 2. `true`
 */

/**
 * TransferSpec.lock_rate_policy -> Boolean
 *
 * *optional*
 *
 * Prevents the user from changing the rate policy during a transfer.
 *
 * Values:
 *
 * 1. `false` (default)
 * 2. `true`
 */

/**
 * TransferSpec.lock_target_rate -> Boolean
 *
 * *optional*
 *
 * Prevents the user from changing the target rate during a transfer.
 *
 * Values:
 *
 * 1. `false` (default)
 * 2. `true`
 */

/**
 * TransferSpec.min_rate_kbps -> Number
 *
 * *optional*
 *
 * The minimum speed of the transfer. fasp™ will only share bandwidth exceeding
 * this value.
 *
 * Note: This value has no effect if `rate_policy` is `"fixed"`.
 *
 * Default: Server-side minimum rate default setting (aspera.conf). Will
 * respect both local- and server-side minimum rate caps if set.
 */

/**
 * TransferSpec.paths -> Array
 *
 * *required*
 *
 * A list of the file and directory paths to transfer. Use `destination_root`
 * to specify the destination directory.
 *
 * ##### Source list format
 *
 *     [
 *       {
 *         "source": "/foo"
 *       }, {
 *         "source": "/bar/baz"
 *       },
 *       ...
 *     ]
 *
 * Optionally specify a destination path - including the file name - for each
 * file. This format is useful for renaming files or sending to different
 * destinations. Note that for this format all paths must be file paths (not
 * directory paths).
 *
 * ##### Source-Destination pair format
 *
 *     [
 *       {
 *         "source": "/foo",
 *         "destination": "/qux/foofoo"
 *       }, {
 *         "source": "/bar/baz",
 *         "destination": "/qux/bazbaz"
 *       },
 *       ...
 *     ]
 */

/**
 * TransferSpec.rate_policy -> String
 *
 * *optional*
 *
 * The congestion control behavior to use when sharing bandwidth.
 *
 * Values:
 *
 * 1. `"fixed"`: Transfer at the target rate, regardless of the actual network
 * capacity. Do not share bandwidth.
 * 2. `"high"`: When sharing bandwidth, transfer at twice the rate of a
 * transfer using a "fair" policy.
 * 3. `"fair"` (default): Share bandwidth equally with other traffic.
 * 4. `"low"`: Use only unutilized bandwidth.
 */

/**
 * TransferSpec.remote_host -> String
 *
 * *required*
 *
 * The fully qualified domain name or IP address of the transfer server.
 */

/**
 * TransferSpec.remote_password -> String
 *
 * *optional*
 *
 * The password to use when `authentication` is set to `"password"`. If this
 * value is not specified, Connect will prompt the user.
 */

/**
 * TransferSpec.remote_user -> String
 *
 * *optional*
 *
 * The username to use for authentication. For password authentication, if
 * this value is not specified, Connect will prompt the user.
 */

/**
 * TransferSpec.resume -> String
 *
 * *optional*
 *
 * The policy to use when resuming partially transferred (incomplete) files.
 *
 * Values:
 *
 * 1. `"none"`: Transfer the entire file again.
 * 2. `"attributes"`: Resume if the files' attributes match.
 * 3. `"sparse_checksum"` (default): Resume if the files' attributes and sparse
 * (fast) checksums match.
 * 4. `"full_checksum"`: Resume if the files' attributes and full checksums
 * match. Note that computing full checksums of large files takes time, and
 * heavily utilizes the CPU.
 */

/**
 * TransferSpec.ssh_port -> Number
 *
 * *optional*
 *
 * The server's TCP port that is listening for SSH connections. fasp™ initiates
 * transfers through SSH.
 *
 * Default: `33001`
 */

/**
 * TransferSpec.source_root -> String
 *
 * *optional*
 *
 * A path to prepend to the source paths specified in `paths`. If this is not
 * specified, then `paths` should contain absolute paths.
 *
 * Default: `"/"`
 */

/**
 * TransferSpec.tags -> Object
 *
 * *optional*
 *
 * Additional tags to include in the `TransferSpec`. The tags will be available
 * in [[TransferInfo]]. This is useful for associating metadata with the
 * transfer.
 *
 * ##### Tags format
 *
 *     {
 *       "your_company": {
 *         "key": "value"
 *       }
 *     }
 */

/**
 * TransferSpec.target_rate_cap_kbps -> Number
 *
 * *optional*
 *
 * Limit the transfer rate that the user can adjust the target and minimum
 * rates to.
 *
 * Default: no limit
 */

/**
 * TransferSpec.target_rate_kbps -> Number
 *
 * *optional*
 *
 * The desired speed of the transfer. If there is competing network traffic,
 * fasp™ may share this bandwidth, depending on the `rate_policy`.
 *
 * Default: Server-side target rate default setting (aspera.conf). Will
 * respect both local- and server-side target rate caps if set.
 */

/**
 * TransferSpec.token -> String
 *
 * *optional*
 *
 * Used for token-based authorization, which involves the server-side
 * application generating a token that gives the client rights to transfer
 * a predetermined set of files.
 *
 * Default: none
 */

/** section: Objects
 * class ConnectSpec
 *
 * Connect-specific parameters when starting a transfer.
 *
 * ##### Example
 *
 *     {
 *       "allow_dialogs" : false,
 *       "back_link" : "www.foo.com",
 *       "return_paths" : false,
 *       "return_files" : false,
 *       "use_absolute_destination_path" : true
 *     }
 */

/**
 * ConnectSpec.allow_dialogs -> Boolean
 *
 * *optional*
 *
 * If this value is `false`, Connect will no longer prompt or display windows
 * automatically, except to ask the user to authorize transfers if the server
 * is not on the list of trusted hosts.
 *
 * Values:
 *
 * 1. `true` (default)
 * 2. `false`
 */

/**
 * ConnectSpec.back_link -> String
 *
 * *optional*
 *
 * A URL to associate with the transfer. Connect will display this link
 * in the context menu of the transfer.
 *
 * Default: The URL of the current page
 */

/**
 * ConnectSpec.return_files -> Boolean
 *
 * *optional*
 *
 * If this value is `false`, [[TransferInfo]] will not contain
 * [[TransferInfo.files]]. Use this option to prevent performance deterioration
 * when transferring large number of files.
 *
 * Values:
 *
 * 1. `true` (default)
 * 2. `false`
 */

/**
 * ConnectSpec.return_paths -> Boolean
 *
 * *optional*
 *
 * If this value is `false`, [[TransferInfo]] will not contain
 * [[TransferSpec.paths]]. Use this option to prevent performance deterioration
 * when specifying a large number of source paths.
 *
 * Values:
 *
 * 1. `true` (default)
 * 2. `false`
 */

/**
 * ConnectSpec.use_absolute_destination_path -> Boolean
 *
 * *optional*
 *
 * By default, the destination of a download is relative to the user's Connect
 * download directory setting. Setting this value to `true` overrides this
 * behavior, using absolute paths instead.
 *
 * Values:
 *
 * 1. `false` (default)
 * 2. `true`
 */

/** section: Objects
 * class FileFilters
 *
 * A set of file extension filters.
 *
 * ##### Example
 *
 *     [
 *       {
 *         filter_name : "Text file",
 *         extensions : ["txt"]
 *       },
 *       {
 *         filter_name : "Image file",
 *         extensions : ["jpg", "png"]
 *       },
 *       {
 *         filter_name : "All types",
 *         extensions : ["*"]
 *       }
 *     ]
 */
