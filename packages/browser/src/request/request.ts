import NPAPIrequestImplementation from './npapi';
import NativeMessageExtRequestImplementation from './native-message-ext';
import SafariAppExtRequestImplementation from './safari-app-ext';
import XMLhttpRequestImplementation from './http';
import * as Logger from '../logger';
import * as Utils from '../utils';
import { ConnectInstaller } from '../installer';
import BROWSER from '../shared/browser';
import {
  MIN_SECURE_VERSION,
  MAX_POLLING_ERRORS,
  HTTP_METHOD
} from '../shared/constants';
import { connectVersion, STATUS } from '../shared/sharedInternals';

interface ICallback {
  success?(): any;
  error?(): any;
}

interface IRequest {
  id: number;
  method: string;
  path: string;
  data: string | null;
  callbacks: ICallback;
}

interface IOptions {
  minVersion: string;
  pluginId: string;
  containerId: string;
  initializeTimeout: number;
  sdkLocation: string;
  connectMethod: string;
  callback(): any;
  requestStatusCallback(): any;
}

class RequestHandler {
  static STATUS = STATUS;
  
  // Helper to keep track of multiple instances
  objectId = Utils.nextObjectId();
  // Technology we are going to use to make the http requests
  requestImplementation: any = null;
  connectStatus = 0;
  //  Position in which we are going to store the callbacks for a requests
  nextId = 0;
  //  Hash in which we are going to store the callbacks for the requests
  idCallbackHash: any = {};
  //  Array in which we are going to store all the requests that cannot be processed at this time
  requestQueue: IRequest[] = [];
  //  Listeners for connect status
  statusListener: any = null;
  minVersion = '';
  // Track number of polling errors for debounce
  pollingRequestErrors = 0;
  
  constructor() {}
  
  processQueue = () => {
      // Process all pending requests
      while (this.requestQueue.length > 0) {
          var requestInfo = this.requestQueue.pop();
          if (requestInfo) {
            this.requestImplementation.httpRequest(requestInfo.method, requestInfo.path, requestInfo.data, this.handleResponse, requestInfo.id, Utils.SESSION_ID);
          }
      }
      return null;
  };
  
  changeConnectStatus = (newConnectStatus: number) => {
      Logger.debug('[' + this.objectId + '] Request handler status changing from[' + STATUS.toString(this.connectStatus)
          + '] to[' + STATUS.toString(newConnectStatus) + ']');
      this.connectStatus = newConnectStatus;
      if (this.connectStatus == STATUS.RUNNING)
          this.processQueue();
      // Check for status internal to request handler
      if (this.connectStatus == STATUS.DEGRADED) {
          this.checkVersion(); // Attempt to reconnect
          return;
      }
      if (this.statusListener !== null)
          this.statusListener(this.connectStatus);
      return null;
  };
  
  checkVersionCallback = (httpCode: number, response: any, requestId: number) => {
      delete this.idCallbackHash[requestId];
      if (httpCode == 200) {
          var parsedResponse = Utils.parseJson(response);
          var hasError = typeof parsedResponse.error != 'undefined';
          if (hasError) {
              Logger.error('Failed to parse version response: ' + response);
              return;
          }
          connectVersion.set(parsedResponse.version);
          // AW4.connectVersion = parsedResponse.version;
      }

      if (this.connectStatus == STATUS.OUTDATED && !Utils.checkVersionException()) {
          return;
      }

      if (!Utils.checkVersionException()) {
          if (this.minVersion == '' || Utils.versionLessThan(this.minVersion, MIN_SECURE_VERSION)) {
              this.minVersion = MIN_SECURE_VERSION;
          }
          if (Utils.versionLessThan(connectVersion.value(), this.minVersion)) {
              this.changeConnectStatus(STATUS.OUTDATED);

              // Trigger update interface in Connect
              let requestId = this.nextId++;
              const method = HTTP_METHOD.POST;
              const path = "/connect/update/require";
              let postData = { min_version: this.minVersion, sdk_location: Utils.SDK_LOCATION };
              let requestInfo = { id: requestId, method: method, path: path, data: null, callbacks: null };
              this.idCallbackHash[requestId] = requestInfo;
              this.requestImplementation.httpRequest(method, path, JSON.stringify(postData), null, requestId, Utils.SESSION_ID);
              return;
          }
      }
      this.changeConnectStatus(STATUS.RUNNING);
  };
  
  checkVersion = () => {
      var requestId = this.nextId++;
      var method = HTTP_METHOD.GET;
      var path = "/connect/info/version";
      var requestInfo = { id: requestId, method: method, path: path, data: null, callbacks: null };
      this.idCallbackHash[requestId] = requestInfo;

      this.requestImplementation.httpRequest(HTTP_METHOD.GET, path, null, this.checkVersionCallback, requestId, null);
  };
  
  handleResponse = (httpCode: number, response: any, requestId: number) => {
      if (this.connectStatus == STATUS.STOPPED) {
          Logger.debug('Connect stopped. Skipping request processing.');
          return null;
      }

      var requestInfo = this.idCallbackHash[requestId];
      if (!requestInfo) {
          //We shouldn't reach this point
          //Received response from server for which there is no callback
          return;
      }
      //connection error (either wrong port or connect not running)
      if (httpCode == 0) {
          //This was a client request, so queue it until we restablish connection with the server
          if (this.pollingRequestErrors < MAX_POLLING_ERRORS
              && requestInfo.path.indexOf('/connect/transfers/activity') > 0) {
              this.pollingRequestErrors++;
              requestInfo.callbacks.error({});
              return;
          }
          this.requestQueue.push(requestInfo);
          return null;
      } else {
          if (this.connectStatus != STATUS.RUNNING) {
              this.changeConnectStatus(STATUS.RUNNING);
          }
          var parsedResponse = Utils.parseJson(response);
          if (httpCode == 200 && typeof parsedResponse.error === 'undefined') {
              this.pollingRequestErrors = 0;
              //Call back with the response retrieved from connect if parsing is ok
              var callback = requestInfo.callbacks.success;
              callback(parsedResponse);
          } else {
              //Call back with error
              var callback = requestInfo.callbacks.error;
              callback(parsedResponse);
          }
          //remove object
          delete this.idCallbackHash[requestId];
          return null;
      }
  };
  
  addStatusListener = (callback: any) => {
      this.statusListener = callback;
  };
  
  start = (method: string, path: string, data: string | null, sessionId: string, callbacks: any) => {
      if (this.connectStatus == STATUS.STOPPED) {
          return null;
      }
      if (callbacks == ""|| callbacks == null || typeof callbacks ==='undefined') {
          callbacks = {};
      }
      //Prepare callbacks
      if (typeof callbacks.success !== 'function') {
          callbacks.success = function(){};
      }
      if (typeof callbacks.error !== 'function') {
          callbacks.error = function(){};
      }

      var requestId = this.nextId++;
      var requestInfo: IRequest = { id: requestId, method: method, path: path, data: data, callbacks: callbacks };
      this.idCallbackHash[requestId] = requestInfo;

      if (this.connectStatus == STATUS.DEGRADED) {
          this.checkVersion(); // Attempt to reconnect
      }

      //if connect is not ready, queue the request
      if (this.connectStatus != STATUS.RUNNING) {
          this.requestQueue.push(requestInfo);
          return null;
      }

      this.requestImplementation.httpRequest(method, path, data, this.handleResponse, requestId, sessionId);
      return null;
  };
  
  init = (options: IOptions) => {
      // Change connect status to initailizing
      this.changeConnectStatus(STATUS.INITIALIZING);

      this.minVersion = options.minVersion;
      let initializationOptions = {
          pluginId: options.pluginId,
          containerId: options.containerId,
          initializeTimeout: options.initializeTimeout,
          sdkLocation: options.sdkLocation,
          callback: this.checkVersion,
          requestStatusCallback: this.changeConnectStatus
      };

      // Find the request implementation that is optimal for this environment
      // Use NPAPI if available
      let npapiRequestImpl = new NPAPIrequestImplementation();
      if (npapiRequestImpl.isSupportedByBrowser()) {
          this.requestImplementation = npapiRequestImpl;
          this.requestImplementation.init(initializationOptions);
          return;
      }

      let setRequestImpl = (impl: any) => {
          this.requestImplementation = impl;
          if (!this.requestImplementation.isSupportedByBrowser()) {
              return Utils.createError(-1, "This browser is not supported");
          }
          this.requestImplementation.init(initializationOptions);
      }
      let startInitTimeout = () => {
          let initializeTimeoutCallback = () => {
              if (this.connectStatus != STATUS.RUNNING && this.connectStatus != STATUS.OUTDATED) {
                  Logger.log('Connect detection timed out after: ' + options.initializeTimeout + 'ms');
                  this.changeConnectStatus(STATUS.FAILED);
              }
          };
          setTimeout(initializeTimeoutCallback, options.initializeTimeout);
      }
      function setHttpRequestImpl() {
          Logger.debug('Using http request implementation');
          startInitTimeout();
          setRequestImpl(new XMLhttpRequestImplementation());
      }

      let extReqImpl: any;
      if (BROWSER.SAFARI_NO_NPAPI)
          extReqImpl = new SafariAppExtRequestImplementation();
      else
          extReqImpl = new NativeMessageExtRequestImplementation();

      if (options.connectMethod == 'http' || !extReqImpl.isSupportedByBrowser()) {
          setHttpRequestImpl();
      } else {
          var min39 = this.minVersion != '' && !Utils.versionLessThan(this.minVersion, '3.9');
          var supportsInstall = ConnectInstaller.supportsInstallingExtensions == true;
          // Look for extension for up to 1s. Otherwise fallback to http takes too long.
          extReqImpl.detectExtension(1000, {
              success: function() {
                  setRequestImpl(extReqImpl);
              },
              timedout: () => {
                  if (options.connectMethod == 'extension' || (supportsInstall && min39)) {
                      if (BROWSER.SAFARI_NO_NPAPI) {
                          startInitTimeout();
                      } else {
                          this.changeConnectStatus(STATUS.EXTENSION_INSTALL);
                          window.postMessage('show_extension_install', '*');
                      }
                      setRequestImpl(extReqImpl);
                  } else {
                      setHttpRequestImpl();
                  }
              }
          });
      }
  };
  
  stopRequests = () => {
      this.connectStatus = STATUS.STOPPED;
      if (typeof this.requestImplementation.stop == "function")
          this.requestImplementation.stop();
      return true;
  };
}

export default RequestHandler;
