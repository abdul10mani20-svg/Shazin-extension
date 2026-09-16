(function () {
  const root = typeof globalThis !== "undefined" ? globalThis : self;

  if (root.chrome && root.chrome.runtime) {
    return;
  }

  const browserApi = root.browser;
  if (!browserApi || !browserApi.runtime) {
    return;
  }

  let callbackLastError = null;

  function callCallback(callback, value, error) {
    callbackLastError = error
      ? { message: error.message || String(error) }
      : null;
    try {
      callback(value);
    } finally {
      callbackLastError = null;
    }
  }

  function withCallback(result, callback) {
    const promise = Promise.resolve(result);
    if (typeof callback !== "function") {
      return promise;
    }
    promise.then(
      (value) => callCallback(callback, value, null),
      (error) => callCallback(callback, undefined, error),
    );
    return undefined;
  }

  function bindPromiseApi(namespace, method) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      const callback = typeof args[args.length - 1] === "function" ? args.pop() : undefined;
      try {
        return withCallback(namespace[method].apply(namespace, args), callback);
      } catch (error) {
        if (typeof callback === "function") {
          callCallback(callback, undefined, error);
          return undefined;
        }
        return Promise.reject(error);
      }
    };
  }

  function copyNamespace(name, methods) {
    const namespace = browserApi[name];
    if (!namespace) return undefined;
    const target = Object.assign({}, namespace);
    methods.forEach((method) => {
      if (typeof namespace[method] === "function") {
        target[method] = bindPromiseApi(namespace, method);
      }
    });
    return target;
  }

  const runtime = copyNamespace("runtime", ["sendMessage", "getPlatformInfo", "openOptionsPage"]);
  if (runtime) {
    Object.defineProperty(runtime, "lastError", {
      configurable: true,
      enumerable: true,
      get: () => callbackLastError,
    });
  }

  const storage = browserApi.storage ? Object.assign({}, browserApi.storage) : undefined;
  if (storage && browserApi.storage.local) {
    storage.local = Object.assign({}, browserApi.storage.local);
    ["get", "set", "remove", "clear"].forEach((method) => {
      if (typeof browserApi.storage.local[method] === "function") {
        storage.local[method] = bindPromiseApi(browserApi.storage.local, method);
      }
    });
  }

  root.chrome = {
    action: copyNamespace("action", ["setBadgeText", "setBadgeBackgroundColor", "setTitle"]),
    cookies: copyNamespace("cookies", ["get", "getAll", "set", "remove"]),
    runtime,
    scripting: copyNamespace("scripting", ["executeScript", "insertCSS", "removeCSS"]),
    sidePanel: copyNamespace("sidePanel", ["open", "setPanelBehavior", "getOptions", "setOptions"]),
    sidebarAction: copyNamespace("sidebarAction", ["open", "close", "setPanel", "setTitle", "setIcon"]),
    storage,
    tabs: copyNamespace("tabs", ["query", "create", "sendMessage", "update"]),
  };
})();
