/**
 * Copyright 2019 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const {Events} = require('./Events');
const {Page} = require('./Page');
const {Worker: PuppeteerWorker} = require('./Worker');
// CDPSession is used only as a typedef
// eslint-disable-next-line no-unused-vars
const {CDPSession} = require('./Connection');
// This import is used as a TypeDef, but ESLint's rule doesn't
// understand that unfortunately.
// eslint-disable-next-line no-unused-vars
const {TaskQueue} = require('./TaskQueue');

class Target {
  /**
   * @param {!Protocol.Target.TargetInfo} targetInfo
   * @param {!Puppeteer.BrowserContext} browserContext
   * @param {!function():!Promise<!CDPSession>} sessionFactory
   * @param {boolean} ignoreHTTPSErrors
   * @param {?Puppeteer.Viewport} defaultViewport
   * @param {!TaskQueue} screenshotTaskQueue
   */
  constructor(targetInfo, browserContext, sessionFactory, ignoreHTTPSErrors, defaultViewport, screenshotTaskQueue) {
    this._targetInfo = targetInfo;
    this._browserContext = browserContext;
    this._targetId = targetInfo.targetId;
    this._sessionFactory = sessionFactory;
    this._ignoreHTTPSErrors = ignoreHTTPSErrors;
    this._defaultViewport = defaultViewport;
    this._screenshotTaskQueue = screenshotTaskQueue;
    /** @type {?Promise<!Puppeteer.Page>} */
    this._pagePromise = null;
    /** @type {?Promise<!PuppeteerWorker>} */
    this._workerPromise = null;
    this._initializedPromise = new Promise(fulfill => this._initializedCallback = fulfill).then(async success => {
      if (!success)
        return false;
      const opener = this.opener();
      if (!opener || !opener._pagePromise || this.type() !== 'page')
        return true;
      const openerPage = await opener._pagePromise;
      if (!openerPage.listenerCount(Events.Page.Popup))
        return true;
      const popupPage = await this.page();
      openerPage.emit(Events.Page.Popup, popupPage);
      return true;
    });
    this._isClosedPromise = new Promise(fulfill => this._closedCallback = fulfill);
    this._isInitialized = this._targetInfo.type !== 'page' || this._targetInfo.url !== '';
    if (this._isInitialized)
      this._initializedCallback(true);
  }

  /**
   * @return {!Promise<!CDPSession>}
   */
  createCDPSession() {
    return this._sessionFactory();
  }

  /**
   * @return {!Promise<?Page>}
   */
  async page() {
    if ((this._targetInfo.type === 'page' || this._targetInfo.type === 'background_page') && !this._pagePromise) {
      this._pagePromise = this._sessionFactory()
          .then(client => Page.create(client, this, this._ignoreHTTPSErrors, this._defaultViewport, this._screenshotTaskQueue));
    }
    return this._pagePromise;
  }

  /**
   * @return {!Promise<?PuppeteerWorker>}
   */
  async worker() {
    if (this._targetInfo.type !== 'service_worker' && this._targetInfo.type !== 'shared_worker')
      return null;
    if (!this._workerPromise) {
      // TODO(einbinder): Make workers send their console logs.
      this._workerPromise = this._sessionFactory()
          .then(client => new PuppeteerWorker(client, this._targetInfo.url, () => {} /* consoleAPICalled */, () => {} /* exceptionThrown */));
    }
    return this._workerPromise;
  }

  /**
   * @return {string}
   */
  url() {
    return this._targetInfo.url;
  }

  /**
   * @return {"page"|"background_page"|"service_worker"|"shared_worker"|"other"|"browser"}
   */
  type() {
    const type = this._targetInfo.type;
    if (type === 'page' || type === 'background_page' || type === 'service_worker' || type === 'shared_worker' || type === 'browser')
      return type;
    return 'other';
  }

  /**
   * @return {!Puppeteer.Browser}
   */
  browser() {
    return this._browserContext.browser();
  }

  /**
   * @return {!Puppeteer.BrowserContext}
   */
  browserContext() {
    return this._browserContext;
  }

  /**
   * @return {?Puppeteer.Target}
   */
  opener() {
    const { openerId } = this._targetInfo;
    if (!openerId)
      return null;
    return this.browser()._targets.get(openerId);
  }

  /**
   * @param {!Protocol.Target.TargetInfo} targetInfo
   */
  _targetInfoChanged(targetInfo) {
    this._targetInfo = targetInfo;

    if (!this._isInitialized && (this._targetInfo.type !== 'page' || this._targetInfo.url !== '')) {
      this._isInitialized = true;
      this._initializedCallback(true);
      return;
    }
  }
}

module.exports = {Target};
