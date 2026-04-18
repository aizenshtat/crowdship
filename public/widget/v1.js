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
        title: typeof input === 'string' ? input : '',
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
      scriptUrl: script.src || '',
    },
    user: {
      id: readAttr(script, 'data-crowdship-user-id'),
      email: readAttr(script, 'data-crowdship-user-email'),
      role: readAttr(script, 'data-crowdship-user-role'),
    },
    context: {},
    request: normalizeRequest('Suggest a change'),
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
      '.crowdship-frame{width:100%;height:100%;border:0;border-radius:8px;box-shadow:0 18px 42px rgba(24,32,41,.18);background:#eef1ee;pointer-events:auto;}',
      '.crowdship-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483001;min-height:44px;min-width:44px;padding:12px 16px;border:1px solid #17362e;border-radius:8px;background:#184c3d;color:#fff;font:600 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;text-decoration:none;cursor:pointer;box-shadow:0 10px 24px rgba(24,32,41,.14);}',
      '.crowdship-launcher:focus{outline:2px solid #0f766e;outline-offset:2px;}',
      '.crowdship-launcher[data-open="true"]{opacity:0.92;}',
      '@media (max-width: 720px){.crowdship-shell{inset:0;width:100vw;height:100dvh;right:auto;bottom:auto;border-radius:0;}.crowdship-frame{border-radius:0;}.crowdship-launcher{right:12px;bottom:12px;max-width:calc(100vw - 24px);white-space:normal;text-align:left;}}'
    ].join('');
    document.head.appendChild(hostStyle);
  }

  function createLauncher() {
    if (launcher) return launcher;
    ensureHostStyle();
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'crowdship-launcher';
    launcher.textContent = 'Suggest a change';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', 'crowdship-widget-shell');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.addEventListener('click', function () {
      api.open(state.request);
    });
    (document.body || document.documentElement).appendChild(launcher);
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
