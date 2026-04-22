(function () {
  var SCRIPT_ATTR = 'script[data-crowdship-project]';
  var WIDGET_PATH = '/widget/frame.html';

  function getScriptElement() {
    if (document.currentScript && document.currentScript.getAttribute('data-crowdship-project')) {
      return document.currentScript;
    }
    var scripts = document.querySelectorAll(SCRIPT_ATTR);
    return scripts.length ? scripts[scripts.length - 1] : null;
  }

  function readAttr(script, name) {
    var value = script ? script.getAttribute(name) : '';
    return value == null ? '' : value.trim();
  }

  function getScriptOrigin(script) {
    try {
      return new URL(script.src || window.location.href, window.location.href).origin;
    } catch (error) {
      return window.location.origin;
    }
  }

  function clonePlain(value, depth) {
    var nextDepth = depth || 0;
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      if (nextDepth > 5) return [];
      return value.map(function (item) {
        return clonePlain(item, nextDepth + 1);
      });
    }
    if (Object.prototype.toString.call(value) === '[object Object]') {
      if (nextDepth > 5) return {};
      var output = {};
      Object.keys(value).forEach(function (key) {
        var entry = value[key];
        if (typeof entry !== 'function' && typeof entry !== 'symbol' && typeof entry !== 'undefined') {
          output[key] = clonePlain(entry, nextDepth + 1);
        }
      });
      return output;
    }
    return undefined;
  }

  function mergePlain(target, source) {
    var base = target && Object.prototype.toString.call(target) === '[object Object]' ? target : {};
    var incoming = source && Object.prototype.toString.call(source) === '[object Object]' ? source : {};
    var result = {};
    Object.keys(base).forEach(function (key) {
      result[key] = clonePlain(base[key], 0);
    });
    Object.keys(incoming).forEach(function (key) {
      var current = incoming[key];
      if (current && Object.prototype.toString.call(current) === '[object Object]' && !Array.isArray(current)) {
        result[key] = mergePlain(result[key], current);
      } else {
        result[key] = clonePlain(current, 0);
      }
    });
    return result;
  }

  function normalizeRequest(input) {
    if (!input || typeof input === 'string') {
      return {
        type: 'feature_request',
        title: typeof input === 'string' && input !== 'Suggest a change' ? input : '',
        body: '',
      };
    }
    return {
      type: input.type || 'feature_request',
      title: typeof input.title === 'string' ? input.title : '',
      body: typeof input.body === 'string' ? input.body : '',
      route: typeof input.route === 'string' ? input.route : '',
      url: typeof input.url === 'string' ? input.url : '',
    };
  }

  function normalizeStyleToken(value) {
    if (typeof value !== 'string') return '';
    var text = value.trim();
    if (!text || text.length > 80 || /[;{}<>]/.test(text)) return '';
    return text;
  }

  function normalizeRadiusToken(value) {
    if (typeof value === 'number' && isFinite(value)) return value + 'px';
    var text = normalizeStyleToken(value);
    if (/^\d+(\.\d+)?$/.test(text)) return text + 'px';
    return text;
  }

  function normalizeTheme(input) {
    var theme = input && Object.prototype.toString.call(input) === '[object Object]' ? input : {};
    var output = {};
    ['accent', 'background', 'surface', 'text', 'muted', 'radius'].forEach(function (key) {
      var value = key === 'radius' ? normalizeRadiusToken(theme[key]) : normalizeStyleToken(theme[key]);
      if (value) {
        output[key] = value;
      }
    });
    return output;
  }

  function readTheme(script) {
    return normalizeTheme({
      accent: readAttr(script, 'data-crowdship-accent') || readAttr(script, 'data-crowdship-accent-color'),
      background: readAttr(script, 'data-crowdship-background') || readAttr(script, 'data-crowdship-background-color'),
      surface: readAttr(script, 'data-crowdship-surface') || readAttr(script, 'data-crowdship-surface-color'),
      text: readAttr(script, 'data-crowdship-text') || readAttr(script, 'data-crowdship-text-color'),
      muted: readAttr(script, 'data-crowdship-muted') || readAttr(script, 'data-crowdship-muted-color'),
      radius: readAttr(script, 'data-crowdship-radius'),
    });
  }

  function cleanStorageKeyPart(value) {
    var text = typeof value === 'string' ? value.trim() : '';
    return text ? encodeURIComponent(text).slice(0, 120) : 'anonymous';
  }

  function createRequesterSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'crqs_' + window.crypto.randomUUID();
    }
    return 'crqs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  }

  function readRequesterSessionId(script) {
    var explicit = readAttr(script, 'data-crowdship-requester-session-id');
    if (explicit) {
      return explicit.slice(0, 120);
    }

    var key = [
      'crowdship:requester-session',
      cleanStorageKeyPart(readAttr(script, 'data-crowdship-project')),
      cleanStorageKeyPart(readAttr(script, 'data-crowdship-environment') || 'production'),
      cleanStorageKeyPart(window.location.origin),
    ].join(':');

    try {
      if (window.localStorage) {
        var stored = window.localStorage.getItem(key);
        if (stored && stored.trim()) {
          return stored.trim().slice(0, 120);
        }
        var next = createRequesterSessionId();
        window.localStorage.setItem(key, next);
        return next;
      }
    } catch (error) {
      // Storage may be disabled. The current page session still gets a usable key.
    }

    return createRequesterSessionId();
  }

  var script = getScriptElement();
  if (!script) {
    return;
  }
  var widgetOrigin = getScriptOrigin(script);
  var widgetFrameUrl = new URL(WIDGET_PATH, widgetOrigin).toString();

  var state = {
    config: {
      project: readAttr(script, 'data-crowdship-project'),
      environment: readAttr(script, 'data-crowdship-environment') || 'production',
      launcher: readAttr(script, 'data-crowdship-launcher') || 'auto',
      launcherLabel: readAttr(script, 'data-crowdship-launcher-label') || 'Suggest a change',
      scriptUrl: script.src || '',
      theme: readTheme(script),
    },
    user: {
      id: readAttr(script, 'data-crowdship-user-id'),
      email: readAttr(script, 'data-crowdship-user-email'),
      role: readAttr(script, 'data-crowdship-user-role'),
      requesterSessionId: readRequesterSessionId(script),
    },
    context: {},
    request: normalizeRequest(),
    isOpen: false,
  };

  var shell = null;
  var iframe = null;
  var launcher = null;
  var iframeLoaded = false;
  var frameReady = false;
  var hostStyle = null;

  function ensureHostStyle() {
    if (hostStyle) return;
    hostStyle = document.createElement('style');
    hostStyle.setAttribute('data-crowdship-widget-style', 'true');
    hostStyle.textContent = [
      '.crowdship-shell{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:none;width:min(440px,calc(100vw - 16px));height:min(740px,calc(100vh - 16px));pointer-events:none;}',
      '.crowdship-shell[data-open="true"]{display:block;}',
      '.crowdship-frame{width:100%;height:100%;border:0;border-radius:var(--crowdship-radius,8px);box-shadow:0 18px 42px rgba(24,32,41,.18);background:var(--crowdship-background,#eef1ee);pointer-events:auto;}',
      '.crowdship-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483001;min-height:44px;min-width:44px;padding:12px 16px;border:1px solid var(--crowdship-accent,#17362e);border-radius:var(--crowdship-radius,8px);background:var(--crowdship-accent,#184c3d);color:#fff;font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;text-decoration:none;cursor:pointer;box-shadow:0 10px 24px rgba(24,32,41,.14);}',
      '.crowdship-launcher:focus{outline:2px solid var(--crowdship-accent,#0f766e);outline-offset:2px;}',
      '.crowdship-launcher[data-open="true"]{opacity:0.92;}',
      '@media (max-width: 720px){.crowdship-shell{inset:0;width:100vw;height:100dvh;right:auto;bottom:auto;border-radius:0;}.crowdship-frame{border-radius:0;}.crowdship-launcher{right:12px;bottom:12px;max-width:calc(100vw - 24px);white-space:normal;text-align:left;}}'
    ].join('');
    document.head.appendChild(hostStyle);
  }

  function applyHostTheme() {
    var theme = normalizeTheme(state.config && state.config.theme);
    var targets = [shell, launcher];
    var map = {
      accent: '--crowdship-accent',
      background: '--crowdship-background',
      surface: '--crowdship-surface',
      text: '--crowdship-text',
      muted: '--crowdship-muted',
      radius: '--crowdship-radius',
    };
    targets.forEach(function (target) {
      if (!target || !target.style) return;
      Object.keys(map).forEach(function (key) {
        if (theme[key]) {
          target.style.setProperty(map[key], theme[key]);
        }
      });
    });
    if (launcher) {
      launcher.textContent = state.config.launcherLabel || 'Suggest a change';
    }
  }

  function createLauncher() {
    if (launcher) return launcher;
    ensureHostStyle();
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'crowdship-launcher';
    launcher.textContent = state.config.launcherLabel || 'Suggest a change';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', 'crowdship-widget-shell');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.addEventListener('click', function () {
      api.open();
    });
    (document.body || document.documentElement).appendChild(launcher);
    applyHostTheme();
    return launcher;
  }

  function usesAutoLauncher() {
    return state.config.launcher !== 'manual';
  }

  function createShell() {
    if (shell) return shell;
    ensureHostStyle();
    shell = document.createElement('div');
    shell.className = 'crowdship-shell';
    shell.id = 'crowdship-widget-shell';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-label', 'Crowdship contribution panel');
    iframe = document.createElement('iframe');
    iframe.className = 'crowdship-frame';
    iframe.title = 'Crowdship contribution shell';
    iframe.src = widgetFrameUrl;
    iframe.addEventListener('load', function () {
      iframeLoaded = true;
      syncFrame('crowdship:state');
    });
    shell.appendChild(iframe);
    (document.body || document.documentElement).appendChild(shell);
    applyHostTheme();
    return shell;
  }

  function snapshot() {
    return {
      config: clonePlain(state.config, 0),
      user: clonePlain(state.user, 0),
      context: clonePlain(state.context, 0),
      request: clonePlain(state.request, 0),
      isOpen: !!state.isOpen,
    };
  }

  function syncFrame(type) {
    if (!iframe || !iframe.contentWindow) return;
    if (!iframeLoaded) return;
    iframe.contentWindow.postMessage(
      {
        source: 'crowdship',
        type: type || 'crowdship:state',
        payload: snapshot(),
      },
      widgetOrigin
    );
    frameReady = true;
  }

  function setOpen(open) {
    state.isOpen = !!open;
    if (usesAutoLauncher()) {
      createLauncher().setAttribute('data-open', state.isOpen ? 'true' : 'false');
      launcher.setAttribute('aria-expanded', state.isOpen ? 'true' : 'false');
    }
    createShell().setAttribute('data-open', state.isOpen ? 'true' : 'false');
    if (launcher) {
      launcher.style.display = state.isOpen ? 'none' : 'block';
    }
    shell.style.display = state.isOpen ? 'block' : 'none';
    if (state.isOpen) {
      syncFrame('crowdship:state');
      if (iframe) {
        iframe.focus();
      }
    } else if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        {
          source: 'crowdship',
          type: 'crowdship:close',
          payload: snapshot(),
        },
        widgetOrigin
      );
    }
  }

  function handleChildMessage(event) {
    if (!iframe || event.source !== iframe.contentWindow) return;
    if (event.origin !== widgetOrigin) return;
    var data = event.data || {};
    if (data.source !== 'crowdship') return;
    if (data.type === 'crowdship:close-request') {
      api.close();
    }
  }

  var api = {
    configure: function (options) {
      var incoming = clonePlain(options, 0) || {};
      if (incoming.theme) {
        state.config.theme = mergePlain(state.config.theme, normalizeTheme(incoming.theme));
      }
      if (typeof incoming.launcherLabel === 'string') {
        var launcherLabel = incoming.launcherLabel.trim();
        if (launcherLabel) {
          state.config.launcherLabel = launcherLabel.slice(0, 80);
        }
      }
      applyHostTheme();
      if (state.isOpen) {
        syncFrame('crowdship:state');
      }
    },
    setContext: function (context) {
      state.context = mergePlain(state.context, clonePlain(context, 0));
      if (state.isOpen) {
        syncFrame('crowdship:state');
      }
    },
    identify: function (identity) {
      state.user = mergePlain(state.user, clonePlain(identity, 0));
      if (state.isOpen) {
        syncFrame('crowdship:state');
      }
    },
    open: function (request) {
      state.request = normalizeRequest(request);
      if (usesAutoLauncher()) {
        createLauncher();
      }
      createShell();
      setOpen(true);
      syncFrame('crowdship:init');
    },
    close: function () {
      setOpen(false);
    },
  };

  window.addEventListener('message', handleChildMessage);
  window.Crowdship = api;
  if (usesAutoLauncher()) {
    createLauncher();
  }
})();
