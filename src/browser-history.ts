import { DOM, PLATFORM } from 'aurelia-pal';
import { LinkHandler } from './link-handler';
import { History } from 'aurelia-history';

/**
 * An implementation of the basic history API.
 */
export class BrowserHistory extends History {
  /**@internal */
  static inject = [LinkHandler];

  /**@internal */
  _isActive: boolean;

  /**@internal*/
  location: Location;
  /**@internal*/
  history: typeof PLATFORM['history'];
  /**@internal*/
  linkHandler: LinkHandler;
  /**@internal*/
  options: any;
  /**@internal*/
  root: string;
  /**@internal*/
  _wantsHashChange: boolean;
  /**@internal*/
  _hasPushState: boolean;
  /**@internal*/
  fragment: string;

  /**
   * Creates an instance of BrowserHistory
   * @param linkHandler An instance of LinkHandler.
   */
  constructor(linkHandler: LinkHandler) {
    super();

    this._isActive = false;
    this._checkUrl = this._checkUrl.bind(this);

    this.location = PLATFORM.location;
    this.history = PLATFORM.history;
    this.linkHandler = linkHandler;
  }

  /**
   * Activates the history object.
   * @param options The set of options to activate history with.
   * @returns Whether or not activation occurred.
   */
  activate(options?: Object): boolean {
    if (this._isActive) {
      throw new Error('History has already been activated.');
    }

    let $history = this.history;
    let wantsPushState = !!(options as any).pushState;

    this._isActive = true;
    let normalizedOptions = this.options = Object.assign({}, { root: '/' }, this.options, options);

    // Normalize root to always include a leading and trailing slash.
    let rootUrl = this.root = ('/' + normalizedOptions.root + '/').replace(rootStripper, '/');

    let wantsHashChange = this._wantsHashChange = normalizedOptions.hashChange !== false;
    let hasPushState = this._hasPushState = !!(normalizedOptions.pushState && $history && $history.pushState);

    // Determine how we check the URL state.
    let eventName: string;
    if (hasPushState) {
      eventName = 'popstate';
    } else if (wantsHashChange) {
      eventName = 'hashchange';
    }

    PLATFORM.addEventListener(eventName, this._checkUrl);

    // Determine if we need to change the base url, for a pushState link
    // opened by a non-pushState browser.
    if (wantsHashChange && wantsPushState) {
      // Transition from hashChange to pushState or vice versa if both are requested.
      let $location = this.location;
      let atRoot = $location.pathname.replace(/[^\/]$/, '$&/') === rootUrl;

      // If we've started off with a route from a `pushState`-enabled
      // browser, but we're currently in a browser that doesn't support it...
      if (!hasPushState && !atRoot) {
        let fragment =  this.fragment = this._getFragment(null, true);
        $location.replace(rootUrl + $location.search + '#' + fragment);
        // Return immediately as browser will do redirect to new url
        return true;

        // Or if we've started out with a hash-based route, but we're currently
        // in a browser where it could be `pushState`-based instead...
      } else if (hasPushState && atRoot && $location.hash) {
        let fragment = this.fragment = this._getHash().replace(routeStripper, '');
        $history.replaceState({}, DOM.title, rootUrl + fragment + $location.search);
      }
    }

    if (!this.fragment) {
      this.fragment = this._getFragment('');
    }

    this.linkHandler.activate(this);

    if (!normalizedOptions.silent) {
      return this._loadUrl('');
    }
  }

  /**
   * Deactivates the history object.
   */
  deactivate(): void {
    const handler = this._checkUrl;
    PLATFORM.removeEventListener('popstate', handler);
    PLATFORM.removeEventListener('hashchange', handler);
    this._isActive = false;
    this.linkHandler.deactivate();
  }

  /**
   * Returns the fully-qualified root of the current history object.
   * @returns The absolute root of the application.
   */
  getAbsoluteRoot(): string {
    let $location = this.location;
    let origin = createOrigin($location.protocol, $location.hostname, $location.port);
    return `${origin}${this.root}`;
  }

  /**
   * Causes a history navigation to occur.
   *
   * @param fragment The history fragment to navigate to.
   * @param options The set of options that specify how the navigation should occur.
   * @return Promise if triggering navigation, otherwise true/false indicating if navigation occurred.
   */
  navigate(fragment?: string, {trigger = true, replace = false} = {}): boolean {
    let location = this.location;
    if (fragment && absoluteUrl.test(fragment)) {
      location.href = fragment;
      return true;
    }

    if (!this._isActive) {
      return false;
    }

    fragment = this._getFragment(fragment || '');

    if (this.fragment === fragment && !replace) {
      return false;
    }

    // caching fragment value to prevent triggering load same URL twice
    // as this could potentially trigger hashchange or pushstate
    this.fragment = fragment;

    let url = this.root + fragment;

    // Don't include a trailing slash on the root.
    if (fragment === '' && url !== '/') {
      url = url.slice(0, -1);
    }

    // If pushState is available, we use it to set the fragment as a real URL.
    if (this._hasPushState) {
      url = url.replace('//', '/');
      this.history[replace ? 'replaceState' : 'pushState']({}, DOM.title, url);
    } else if (this._wantsHashChange) {
      // If hash changes haven't been explicitly disabled, update the hash
      // fragment to store history.
      updateHash(location, fragment, replace);
    } else {
      // If you've told us that you explicitly don't want fallback hashchange-
      // based history, then `navigate` becomes a page refresh.
      location.assign(url);
    }

    if (trigger) {
      return this._loadUrl(fragment);
    }

    return true;
  }

  /**
   * Causes the history state to navigate back.
   */
  navigateBack(): void {
    this.history.back();
  }

  /**
   * Sets the document title.
   */
  setTitle(title: string): void {
    DOM.title = title;
  }

  /**
   * Sets a key in the history page state.
   * @param key The key for the value.
   * @param value The value to set.
   */
  setState(key: string, value: any): void {
    let $history = this.history;
    let state = Object.assign({}, $history.state);
    let { pathname, search, hash } = this.location;
    state[key] = value;
    $history.replaceState(state, null, `${pathname}${search}${hash}`);
  }

  /**
   * Gets a key in the history page state.
   * @param key The key for the value.
   * @return The value for the key.
   */
  getState(key: string): any {
    let state = Object.assign({}, this.history.state);
    return state[key];
  }

  /**
   * Returns the current index in the navigation history.
   * @returns The current index.
   */
  getHistoryIndex(): number {
    let historyIndex = this.getState('HistoryIndex');
    if (historyIndex === undefined) {
      historyIndex = this.history.length - 1;
      this.setState('HistoryIndex', historyIndex);
    }
    return historyIndex;
  }

  /**
   * Move to a specific position in the navigation history.
   * @param movement The amount of steps, positive or negative, to move.
   */
  go(movement: number): void {
    this.history.go(movement);
  }

  /**
   * @internal
   */
  _getHash(): string {
    return this.location.hash.substr(1);
  }

  /**
   * @internal
   */
  _getFragment(fragment: string, forcePushState?: boolean): string {
    let rootUrl: string;

    if (!fragment) {
      if (this._hasPushState || !this._wantsHashChange || forcePushState) {
        let location = this.location;
        fragment = location.pathname + location.search;
        rootUrl = this.root.replace(trailingSlash, '');
        if (!fragment.indexOf(rootUrl)) {
          fragment = fragment.substr(rootUrl.length);
        }
      } else {
        fragment = this._getHash();
      }
    }

    // without decoding the fragment
    // _loadUrl will be trigger twice if there are special character in the URL
    return decodeURIComponent('/' + fragment.replace(routeStripper, ''));
  }

  /**
   * Url change handler.
   * Invoked when current fragment is different with previous fragment
   * @internal
   */
  _checkUrl(): void {
    let current = this._getFragment('');
    // a guard to prevent triggering load same URL twice
    // typically happens when calling navigate from router
    if (current !== this.fragment) {
      this._loadUrl('');
    }
  }

  /**
   * invoke routeHandler
   * @internal
   */
  _loadUrl(fragmentOverride: string): boolean {
    let fragment = this.fragment = this._getFragment(fragmentOverride);

    return this.options.routeHandler ?
      this.options.routeHandler(fragment) :
      false;
  }
}

// Cached regex for stripping a leading hash/slash and trailing space.
const routeStripper = /^#?\/*|\s+$/g;

// Cached regex for stripping leading and trailing slashes.
const rootStripper = /^\/+|\/+$/g;

// Cached regex for removing a trailing slash.
const trailingSlash = /\/$/;

// Cached regex for detecting if a URL is absolute,
// i.e., starts with a scheme or is scheme-relative.
// See http://www.ietf.org/rfc/rfc2396.txt section 3.1 for valid scheme format
const absoluteUrl = /^([a-z][a-z0-9+\-.]*:)?\/\//i;

// Update the hash location, either replacing the current entry, or adding
// a new one to the browser history.
function updateHash($location: Location, fragment: string, replace: boolean) {
  if (replace) {
    let href = $location.href.replace(/(javascript:|#).*$/, '');
    $location.replace(href + '#' + fragment);
  } else {
    // Some browsers require that `hash` contains a leading #.
    $location.hash = '#' + fragment;
  }
}

function createOrigin(protocol: string, hostname: string, port: string) {
  return `${protocol}//${hostname}${port ? ':' + port : ''}`;
}
