/**
 * DESYRA Preview Sandbox Runtime
 * Injected as the very first script in the sandboxed preview iframe.
 * Handles console interception, storage shims (localStorage/sessionStorage),
 * error trapping, CSP violation reporting, and relative link navigation.
 */

export interface RuntimeOptions {
  nonce: string;
  initialStorage?: Record<string, string>;
}

export function generatePreviewRuntime(nonce: string, initialStorage: Record<string, string> = {}): string {
  const serializedStorage = JSON.stringify(initialStorage);
  const safeNonce = JSON.stringify(nonce);

  return `(function() {
  'use strict';
  const NONCE = ${safeNonce};
  const INITIAL_STORAGE = ${serializedStorage};

  function sendToParent(payload) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(Object.assign({}, payload, { nonce: NONCE }), '*');
      }
    } catch (e) {
      // Ignore postMessage errors
    }
  }

  // Safe circular-reference serializer with truncation
  function safeSerialize(val, depth, seen) {
    if (depth === undefined) depth = 0;
    if (seen === undefined) seen = new Set();
    if (depth > 4) return '[Object depth limit]';

    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') {
      return val.length > 2000 ? val.slice(0, 2000) + '... [truncated]' : val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'symbol') return val.toString();
    if (typeof val === 'bigint') return val.toString() + 'n';
    if (typeof val === 'function') return '[Function: ' + (val.name || 'anonymous') + ']';

    if (val instanceof Error) {
      return (val.name || 'Error') + ': ' + val.message + (val.stack ? '\\n' + val.stack : '');
    }

    if (typeof val === 'object') {
      if (seen.has(val)) return '[Circular]';
      seen.add(val);

      if (val instanceof Element) {
        let tag = val.tagName.toLowerCase();
        if (val.id) tag += '#' + val.id;
        if (val.className && typeof val.className === 'string') {
          tag += '.' + val.className.trim().split(/\\s+/).join('.');
        }
        return '<' + tag + '>';
      }

      if (Array.isArray(val)) {
        let arrItems = val.slice(0, 50).map(function(item) {
          return safeSerialize(item, depth + 1, seen);
        });
        if (val.length > 50) arrItems.push('... ' + (val.length - 50) + ' more items');
        return '[' + arrItems.join(', ') + ']';
      }

      let entries = [];
      let keys = Object.keys(val).slice(0, 50);
      for (let i = 0; i < keys.length; i++) {
        let k = keys[i];
        try {
          entries.push(k + ': ' + safeSerialize(val[k], depth + 1, seen));
        } catch (err) {
          entries.push(k + ': [Unreadable]');
        }
      }
      return '{ ' + entries.join(', ') + ' }';
    }

    return String(val);
  }

  // 1. Console Interception
  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console)
  };

  function captureConsole(level) {
    const orig = originalConsole[level] || originalConsole.log;
    return function() {
      const args = Array.prototype.slice.call(arguments);
      try {
        orig.apply(console, args);
      } catch (e) {}

      let serializedArgs = [];
      for (let i = 0; i < args.length; i++) {
        serializedArgs.push(safeSerialize(args[i]));
      }

      // Capture callsite if possible
      let source = {};
      try {
        const stack = new Error().stack;
        if (stack) {
          const lines = stack.split('\\n');
          // line 0: Error, line 1: captureConsole, line 2: caller
          const caller = lines[2] || lines[1];
          if (caller) {
            const match = /((?:https?|blob|file):\\/\\/[^:\\s]+):(\\d+)(?::(\\d+))?/.exec(caller);
            if (match) {
              source = { file: match[1], line: parseInt(match[2], 10) };
            }
          }
        }
      } catch (err) {}

      sendToParent({
        type: 'console',
        level: level,
        args: serializedArgs,
        source: source
      });
    };
  }

  console.log = captureConsole('log');
  console.info = captureConsole('info');
  console.warn = captureConsole('warn');
  console.error = captureConsole('error');
  console.debug = captureConsole('debug');

  // 2. Window Error & Unhandled Rejection Listeners
  window.addEventListener('error', function(e) {
    // Check if resource error (target is Element)
    if (e.target && e.target !== window && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
      const src = e.target.src || e.target.href || 'resource';
      sendToParent({
        type: 'console',
        level: 'warn',
        args: ['Failed to load resource: ' + src]
      });
      return;
    }

    sendToParent({
      type: 'console',
      level: 'error',
      args: [e.message || 'Script error'],
      source: { file: e.filename || undefined, line: e.lineno || undefined }
    });
  }, true);

  window.addEventListener('unhandledrejection', function(e) {
    let reasonText = safeSerialize(e.reason);
    sendToParent({
      type: 'console',
      level: 'error',
      args: ['Unhandled Promise Rejection: ' + reasonText]
    });
  });

  // 3. Security Policy Violation Listener
  window.addEventListener('securitypolicyviolation', function(e) {
    sendToParent({
      type: 'console',
      level: 'warn',
      args: [
        'Content Security Policy violation: Blocked ' +
        (e.blockedURI || 'resource') +
        ' by directive "' + (e.violatedDirective || 'CSP') + '"'
      ]
    });
  });

  // 4. Storage Shims (localStorage & sessionStorage)
  function createStorageShim(isLocal) {
    const memory = Object.create(null);

    if (isLocal && INITIAL_STORAGE && typeof INITIAL_STORAGE === 'object') {
      for (const k in INITIAL_STORAGE) {
        if (Object.prototype.hasOwnProperty.call(INITIAL_STORAGE, k)) {
          memory[k] = String(INITIAL_STORAGE[k]);
        }
      }
    }

    const storageObj = {
      getItem: function(key) {
        const k = String(key);
        return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null;
      },
      setItem: function(key, val) {
        const k = String(key);
        const v = String(val);
        memory[k] = v;
        if (isLocal) {
          sendToParent({
            type: 'storage',
            action: 'set',
            key: k,
            value: v
          });
        }
      },
      removeItem: function(key) {
        const k = String(key);
        delete memory[k];
        if (isLocal) {
          sendToParent({
            type: 'storage',
            action: 'remove',
            key: k
          });
        }
      },
      clear: function() {
        for (const k in memory) {
          delete memory[k];
        }
        if (isLocal) {
          sendToParent({
            type: 'storage',
            action: 'clear'
          });
        }
      },
      key: function(index) {
        const keys = Object.keys(memory);
        return index >= 0 && index < keys.length ? keys[index] : null;
      },
      get length() {
        return Object.keys(memory).length;
      }
    };

    // Use Proxy for property access (e.g. localStorage.theme = 'dark')
    return new Proxy(storageObj, {
      get: function(target, prop) {
        if (typeof prop === 'string' && !(prop in target)) {
          return target.getItem(prop);
        }
        return target[prop];
      },
      set: function(target, prop, val) {
        if (typeof prop === 'string' && !(prop in target)) {
          target.setItem(prop, val);
          return true;
        }
        target[prop] = val;
        return true;
      },
      deleteProperty: function(target, prop) {
        if (typeof prop === 'string' && !(prop in target)) {
          target.removeItem(prop);
          return true;
        }
        delete target[prop];
        return true;
      }
    });
  }

  try {
    const localShim = createStorageShim(true);
    Object.defineProperty(window, 'localStorage', {
      value: localShim,
      configurable: true,
      enumerable: true,
      writable: false
    });
  } catch (err) {
    console.warn('[DESYRA] Could not shim localStorage:', err);
  }

  try {
    const sessionShim = createStorageShim(false);
    Object.defineProperty(window, 'sessionStorage', {
      value: sessionShim,
      configurable: true,
      enumerable: true,
      writable: false
    });
  } catch (err) {
    console.warn('[DESYRA] Could not shim sessionStorage:', err);
  }

  // Warn on document.cookie or indexedDB
  try {
    Object.defineProperty(document, 'cookie', {
      get: function() { return ''; },
      set: function() {
        console.warn('[DESYRA Preview] document.cookie is not supported in the sandboxed preview environment.');
      },
      configurable: true
    });
  } catch (err) {}

  // 5. Link Interception for Relative Navigation & Safe Popups
  document.addEventListener('click', function(e) {
    let target = e.target;
    while (target && target !== document && target.tagName !== 'A') {
      target = target.parentElement;
    }
    if (!target || target.tagName !== 'A') return;

    const href = target.getAttribute('href');
    if (!href) return;

    const trimmed = href.trim();
    if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) {
      return;
    }

    // In-page hash jump
    if (trimmed.startsWith('#')) {
      e.preventDefault();
      const elId = trimmed.slice(1);
      const targetEl = document.getElementById(elId) || document.querySelector('[name="' + elId + '"]');
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    // External http/https links
    if (/^https?:\\/\\//i.test(trimmed)) {
      e.preventDefault();
      window.open(trimmed, '_blank', 'noopener,noreferrer');
      return;
    }

    // Mailto & tel: allow browser default
    if (/^(mailto|tel):/i.test(trimmed)) {
      return;
    }

    // Local relative links to other HTML files
    // e.g. "about.html", "./contact.html", "sub/page.html"
    const cleanPath = trimmed.split('?')[0].split('#')[0];
    if (cleanPath.endsWith('.html') || cleanPath.endsWith('.htm')) {
      e.preventDefault();
      sendToParent({
        type: 'navigate',
        path: trimmed
      });
      return;
    }

    // Other protocols/unhandled paths
    console.warn('[DESYRA Preview] Link navigation ignored:', trimmed);
  }, true);

  // 6. Signal Ready on DOMContentLoaded and Loaded on window load
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    sendToParent({ type: 'ready' });
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      sendToParent({ type: 'ready' });
    });
  }

  window.addEventListener('load', function() {
    sendToParent({ type: 'loaded' });
  });
})();`;
}
