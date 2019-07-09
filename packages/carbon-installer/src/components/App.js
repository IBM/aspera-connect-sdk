import React, { Component } from 'react';
import Utils from '../utils';
import ThreeStepBanner from './ThreeStepBanner';
import StatusBanner from './StatusBanner';
import styles from '../styles/components/App.module.scss';

const allowedBannerStates = [
  'launching',
  'running',
  'update',
  'retry',
  'extension_install',
  'download',
  'install',
  'unsupported_browser',
  'safari_mitigate',
  'previous'
];

class App extends Component {
  constructor(props) {
    super(props);
    this.isDownloadRecent = false;
    this.isOutdated = false;

    // When any of the below are updated, the DOM is re-rendered
    this.state = {
      banner: 'launching',
      href: null,
      majorVersion: null
    };
  }

  componentDidMount () {
    window.addEventListener('message', this.handleMessage.bind(this));
  }

  // Callback to allow child components to change banner state
  changeState (newState) {
    this.setState({
      banner: newState
    });
  }

  handleMessage(message) {
    message = message.data.toString();

    if (/downloadlink/.test(message)) {
      let downloadLink = message.split('=')[1];
      this.href = downloadLink;
      this.setState({
        href: downloadLink
      });
    } else if (/downloadVersion/.test(message)) {
      let ver = message.substring(message.indexOf('=') + 1);
      let majorVer = ver.replace(/\.\d+$/, '');
      this.setState({
        majorVersion: majorVer
      });
    } else if (/downloadTimestamp/.test(message)) {
      let lastDownloadTimestamp = message.substring(message.indexOf('=') + 1);
      // Detect if last download timestamp was within 5 minutes
      if ((Date.now() - lastDownloadTimestamp) < 300000) {
        this.isDownloadRecent = true;
      }
    }

    if (allowedBannerStates.indexOf(message) !== -1) {
      console.log(`Received event, transitioning to state: ${message}`);
      this.setState(function(prevState) {
        // Unsupported browser is a terminal state
        if (prevState.banner === 'unsupported_browser' && message !== 'running') {
          return;
        }

        // Handle previous state
        if (message === 'previous') {
          if (prevState.banner) {
            message = prevState.banner;
          } else { // If no previous state then reset installation experience
            if (Utils.BROWSER.SAFARI || Utils.BROWSER.IE) {
              message = 'download';
            } else {
              message = 'extension_install';
            }
          }
        }

        // Remap old states
        if (message === 'retry') {
          message = 'download';
        }

        // Skip to last step if Connect was downloaded recently
        if (message === 'download' && this.isDownloadRecent) {
          console.log('Recent downloaded detected!');
          if (Utils.BROWSER.SAFARI || Utils.BROWSER.IE) {
            message = 'extension_install';
          }
        }
        
        // 3 green checkmark state
        if (message === 'running' && prevState.banner === 'install' && Utils.EXTENSION) {
          message = 'running_with_green_checkmarks';
        }

        // Handle update (outdated) state
        if (message === 'update') {
          this.isOutdated = true;
          message = 'download';
        }

        return {
          banner: message
        }
      });
    }
  }

  renderBanner() {
    console.log(`rendering state: ${this.state.banner}`);
    return this.useStatusBanner() ? <StatusBanner currentState={this.state.banner}/> 
      : <ThreeStepBanner currentState={this.state.banner} href={this.state.href} majorVersion={this.state.majorVersion} isOutdated={this.isOutdated} changeState={this.changeState.bind(this)}/>;
  }

  useStatusBanner () {
    return ['launching', 'running', 'unsupported_browser', 'safari_mitigate'].indexOf(this.state.banner) > -1;
  }

  render() {
    return (
      <div lang={Utils.locale()}>
        <div className={styles.statusBanner}>
          <div className={styles.close}>
            <a href="#" onClick={() => {Utils.sendCloseEvent()}}>x</a>
          </div>
          {this.useStatusBanner() ? (<div className={styles.logo}></div>) : null}
          {this.renderBanner()}
        </div>
        <div id="indicator"></div>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('launching', '*')}}>
          Launching
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('running', '*')}}>
          Running
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('update', '*')}}>
          Outdated
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('retry', '*')}}>
          Retry
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('extension_install', '*')}}>
          Extension Install
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('download', '*')}}>
          Download
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('install', '*')}}>
          Install
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('unsupported_browser', '*')}}>
          Unsupported
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('safari_mitigate', '*')}}>
          Safari Mitigate
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('previous', '*')}}>
          Previous
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('bad_state', '*')}}>
          Bad State
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('downloadlink=https://dwosk.gitlab.aspera.us/connect-api-test-page/dist/v4/bin/IBMAsperaConnectInstallerOneClick-3.9.6.173111.dmg', '*')}}>
          downloadlink
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('downloadVersion=3.9.5.172984', '*')}}>
          downloadVersion
        </button>
        <button
          className="ui-button"
          type="button"
          onClick={() => {window.postMessage('downloadTimestamp=1562006583199', '*')}}>
          downloadTimestamp
        </button>
      </div>
    );
  }
}

export default App;
